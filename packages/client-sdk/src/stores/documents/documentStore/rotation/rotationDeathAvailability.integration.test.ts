import { expect, test } from "bun:test";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import {
  countDeaths,
  openSyncedDevices,
  runtimeAttempts,
  twoDeviceHarness,
} from "../../../../../test/helpers/workflows/acceptedHistoryDevices";
import {
  DocumentRotationUnavailableError,
  readDocumentFoundingUpdate,
} from "../../../../workflows/documents";

type Devices = Awaited<ReturnType<typeof openSyncedDevices>>;

const availability = (owner: Devices["first"]) =>
  owner.runtime.infra.execSql(
    "SELECT status, deaths FROM document_rotation_availability",
  );

// A rotation rebuilds history this device already accepted, so a death
// there is far likelier the rebuild's size or state than the update: it
// counts toward the rotation, never the update. At the limit this device
// leaves the document's rotations to other members, which never wait on it,
// and keeps syncing and editing (#3194).
test("rotation deaths stop this device rotating without voiding the update", async () => {
  const harness = await twoDeviceHarness("rotation-deaths-unavailable", {
    stopsAtVersionVector: true,
  });
  const removeWebLocks = installFakeWebLocks();
  const logged: string[] = [];
  try {
    const { first, founding, peer, store } = await openSyncedDevices(harness);
    await countDeaths(first, harness.documentId(), founding.id, 3, {
      kind: "rotation",
      logError: (message) => logged.push(String(message)),
    });
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);
    expect(await availability(first)).toEqual([
      { deaths: 3, status: "unavailable" },
    ]);
    expect(logged).toEqual([
      expect.stringContaining("leaves them to other members"),
    ]);

    const committedBefore = harness.committed.length;
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
    expect(await availability(first)).toEqual([{ deaths: 2, status: "dying" }]);

    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
    expect(await availability(first)).toEqual([]);

    await die(1);
    expect(await availability(first)).toEqual([{ deaths: 1, status: "dying" }]);
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);
