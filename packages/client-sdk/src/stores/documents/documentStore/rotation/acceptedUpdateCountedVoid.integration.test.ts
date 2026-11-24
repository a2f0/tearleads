import { expect, test } from "bun:test";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import {
  countDeaths,
  loroWindowRows,
  openSyncedDevices,
  runtimeAttempts,
  twoDeviceHarness,
} from "../../../../../test/helpers/stores/acceptedHistoryDevices";
import {
  defaultDocumentsPersistence,
  readDocumentFoundingUpdate,
} from "../../../../workflows/documents";
import { readFinalDocumentVoidUpdateIds } from "../../../../workflows/documents/sync/processedCursor";
import { createDocumentStore } from "../index";

// A founding view reads served history this device already accepted, so
// the deaths it counts can void an update the live document holds (#3194).
// The device then stops vouching for that update: its own rotation proof
// and founding view leave it out, while it still opens, edits, and syncs,
// and no other device waits on it.
test("an accepted update counted void leaves the device syncing and another rotating", async () => {
  const harness = await twoDeviceHarness("accepted-counted-void");
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, founding, peer, second, store } =
      await openSyncedDevices(harness);
    // Three lifetimes die reading the founding update alone in founding
    // views; the fourth's claim records the third attempt, which voids it
    // for good.
    await countDeaths(first, harness.documentId(), founding.id, 3);
    const voids = () =>
      readFinalDocumentVoidUpdateIds(
        first.runtime.infra.execSql,
        harness.documentId(),
      );
    expect([...(await voids())]).toEqual([founding.id]);

    // This device no longer vouches for the update: its founding view and
    // rotation proof leave it out, and the proof fails without a write.
    const readFounding = (owner: typeof first) =>
      readDocumentFoundingUpdate({
        localId: owner.localId,
        runtime: owner.runtime,
        stillCurrent: () => true,
      });
    expect(await readFounding(first)).toBeNull();
    const committedBefore = harness.committed.length;
    await expect(store.assertCanRotateContentKey("prove")).rejects.toThrow(
      "unverified local history",
    );
    expect(harness.committed).toHaveLength(committedBefore);
    expect(await loroWindowRows(first.runtime)).toEqual([]);

    // Another device holds no such verdict, so it proves and reads alone.
    expect(await peer.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
    expect((await readFounding(second))?.content.text).toBe("Founding text");

    // Both devices still edit and sync; each pull serves the void update
    // again, and this device keeps it void without importing it.
    await store.setText("Edited after the void");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    expect(peer.getSnapshot().text).toBe("Edited after the void");
    await peer.setText("Edited on the other device");
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(store.getSnapshot().text).toBe("Edited on the other device");
    expect([...(await voids())]).toEqual([founding.id]);

    // The document still opens from what this device persisted.
    const reopened = createDocumentStore(
      first.localId,
      first.runtime,
      defaultDocumentsPersistence,
      harness.documentId(),
    );
    expect(await reopened.ensureInitialized()).toBe(true);
    expect(reopened.getSnapshot().text).toBe("Edited on the other device");
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);

// A death counted toward an accepted update leaves it unsettled, not void.
// That holds nothing this device syncs: a pull that serves it again reads
// it and accepts it, dropping the attempt, and rotation proves as before.
test("one counted death on an accepted update holds nothing the device syncs", async () => {
  const harness = await twoDeviceHarness("accepted-counted-once");
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, founding, peer, store } = await openSyncedDevices(harness);
    await countDeaths(first, harness.documentId(), founding.id, 1);
    expect(await runtimeAttempts(first, founding.id)).toEqual([
      { attempts: 1 },
    ]);

    await peer.setText("Edited on the other device");
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);

    expect(store.getSnapshot().text).toBe("Edited on the other device");
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);
    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);

// A real server serves a sync pull only what is past the device's version
// vector, so no sync pass reads the founding update again and clears its
// attempts on acceptance. A founding view that reads it and survives does:
// deaths months apart cannot add up to a void (#3194).
test("a clean read between deaths clears an accepted update's attempts", async () => {
  const harness = await twoDeviceHarness("accepted-clean-read", {
    stopsAtVersionVector: true,
  });
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, founding, store } = await openSyncedDevices(harness);
    await countDeaths(first, harness.documentId(), founding.id, 2);
    expect(await runtimeAttempts(first, founding.id)).toEqual([
      { attempts: 2 },
    ]);
    // A sync pass is not served the update again, so its attempts stay.
    await store.setText("Edited between deaths");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(await runtimeAttempts(first, founding.id)).toEqual([
      { attempts: 2 },
    ]);

    const founded = await readDocumentFoundingUpdate({
      localId: first.localId,
      runtime: first.runtime,
      stillCurrent: () => true,
    });
    expect(founded?.content.text).toBe("Founding text");
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);

    await countDeaths(first, harness.documentId(), founding.id, 2);
    expect(await runtimeAttempts(first, founding.id)).toEqual([
      { attempts: 2 },
    ]);
    expect([
      ...(await readFinalDocumentVoidUpdateIds(
        first.runtime.infra.execSql,
        harness.documentId(),
      )),
    ]).toEqual([]);
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);
