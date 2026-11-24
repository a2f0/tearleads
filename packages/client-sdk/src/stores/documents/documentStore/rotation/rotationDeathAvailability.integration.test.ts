import { expect, test } from "bun:test";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import {
  countDeaths,
  openSyncedDevices,
  runtimeAttempts,
  twoDeviceHarness,
} from "../../../../../test/helpers/stores/acceptedHistoryDevices";
import {
  DocumentRotationUnavailableError,
  readDocumentFoundingUpdate,
} from "../../../../workflows/documents";

type Devices = Awaited<ReturnType<typeof openSyncedDevices>>;

const availability = (owner: Devices["first"]) =>
  owner.runtime.infra.execSql(
    "SELECT status, deaths, left_out FROM document_rotation_availability",
  );

// A death in a rotation page of history this device already accepted is
// far likelier the rebuild's size or state than the update: it counts
// toward the rotation, never the update. The limit's death, alone on one
// update, first has the next rebuild leave that update out; the device
// holds it, so that rebuild differs from the live document, and this device
// leaves the document's rotations to other members, which never wait on it,
// and keeps syncing and editing (#3194).
test("rotation deaths stop this device rotating without voiding the update", async () => {
  const harness = await twoDeviceHarness("rotation-deaths-unavailable", {
    stopsAtVersionVector: true,
  });
  const removeWebLocks = installFakeWebLocks();
  const logged: string[] = [];
  const logError = (message: string | Error) => logged.push(String(message));
  try {
    const { first, founding, peer, store } = await openSyncedDevices(harness);
    await countDeaths(first, harness.documentId(), founding.id, 3, {
      kind: "rotation",
      logError,
    });
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);
    expect(await availability(first)).toEqual([
      { deaths: 3, left_out: founding.id, status: "leavingOut" },
    ]);
    expect(logged).toEqual([expect.stringContaining("leaves out the update")]);

    const committedBefore = harness.committed.length;
    await expect(store.assertCanRotateContentKey("prove")).rejects.toThrow(
      "unverified local history",
    );
    expect(await availability(first)).toEqual([
      { deaths: 3, left_out: null, status: "unavailable" },
    ]);
    // Left out unread, the update is not recorded as void.
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);
    // `rotationAvailability.test.ts` covers the report this makes.
    // A rotation started before the limit and dying after it adds nothing.
    await countDeaths(first, harness.documentId(), founding.id, 1, {
      kind: "rotation",
      logError,
    });
    expect(await availability(first)).toEqual([
      { deaths: 3, left_out: null, status: "unavailable" },
    ]);
    expect(logged).toHaveLength(1);

    await expect(store.assertCanRotateContentKey("prove")).rejects.toThrow(
      DocumentRotationUnavailableError,
    );
    expect(harness.committed).toHaveLength(committedBefore);
    expect(await peer.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );

    // The update is not void: this device still reads it, edits, and syncs.
    const founded = await readDocumentFoundingUpdate({
      localId: first.localId,
      runtime: first.runtime,
      stillCurrent: () => true,
    });
    expect(founded?.content.text).toBe("Founding text");
    await store.setText("Edited while rotation is unavailable");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    expect(peer.getSnapshot().text).toBe(
      "Edited while rotation is unavailable",
    );

    // A new decoder identity starts over.
    await first.runtime.infra.execSql(
      "UPDATE document_rotation_availability SET judge = 'void-rules-2:older'",
    );
    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
    expect(await availability(first)).toEqual([]);
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);

// Any writer may declare a span of counters already committed, so an update
// the device never held can look accepted. Rebuilds that die on it alone
// leave it out, and the rebuild without it equals the live document, which
// never held it: the device rotates, without voiding it or counting toward
// it, and keeps leaving it out. Otherwise a writer's crashing update could
// stop every device rotating the document.
test("a rebuild leaving out an update the device never held rotates", async () => {
  const harness = await twoDeviceHarness("rotation-deaths-forged-span", {
    stopsAtVersionVector: true,
  });
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, peer, store } = await openSyncedDevices(harness);
    await peer.setText("A peer edit under a forged span");
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    const forged = harness.committed.at(-1);
    if (!forged) throw new Error("Expected the peer's update");

    await countDeaths(first, harness.documentId(), forged.id, 3, {
      acceptedVersion: forged.partialEndVersionVector,
      kind: "rotation",
    });
    expect(await availability(first)).toEqual([
      { deaths: 3, left_out: forged.id, status: "leavingOut" },
    ]);

    const text = store.getSnapshot().text;
    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
    // Left out unread, none of it reached the installed rebuild.
    expect(store.getSnapshot().text).toBe(text);
    expect(text).not.toBe("A peer edit under a forged span");
    expect(await availability(first)).toEqual([
      { deaths: 0, left_out: forged.id, status: "leftOut" },
    ]);
    // Later rotations leave it out too.
    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
    expect(await runtimeAttempts(first, forged.id)).toEqual([]);
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);

// Raw history also holds updates this device has not accepted, which the
// rotation would install. A death reading one alone says what it says in a
// sync pass, so it counts toward the update and leaves rotation available:
// otherwise any writer's crashing update would stop the document's rotations
// on every device that has not yet voided it.
test("rotation deaths on an update this device has not accepted void it", async () => {
  const harness = await twoDeviceHarness("rotation-deaths-unaccepted", {
    stopsAtVersionVector: true,
  });
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, peer, store } = await openSyncedDevices(harness);
    await peer.setText("A peer edit this device has not pulled");
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    const unaccepted = harness.committed.at(-1);
    if (!unaccepted) throw new Error("Expected the peer's update");

    await countDeaths(first, harness.documentId(), unaccepted.id, 3, {
      kind: "rotation",
    });

    expect(await runtimeAttempts(first, unaccepted.id)).toEqual([
      { attempts: 3 },
    ]);
    expect(await availability(first)).toEqual([]);
    // The void stays out of the rebuild, as it stays out of sync.
    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);

test("a completed rebuild clears rotation deaths below the limit", async () => {
  const harness = await twoDeviceHarness("rotation-deaths-rebuilt", {
    stopsAtVersionVector: true,
  });
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, founding, store } = await openSyncedDevices(harness);
    const die = (deaths: number) =>
      countDeaths(first, harness.documentId(), founding.id, deaths, {
        kind: "rotation",
      });
    await die(2);
    expect(await availability(first)).toEqual([
      { deaths: 2, left_out: null, status: "dying" },
    ]);

    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
    expect(await availability(first)).toEqual([]);

    await die(1);
    expect(await availability(first)).toEqual([
      { deaths: 1, left_out: null, status: "dying" },
    ]);
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);
