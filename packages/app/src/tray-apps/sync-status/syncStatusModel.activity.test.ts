import { expect, test } from "bun:test";
import type { PendingDownloadQueueItem } from "@tearleads/client-sdk";
import {
  selectSyncHolds,
  summarizeDownloadQueue,
  summarizeSyncLanes,
} from "./syncActivityModel";
import {
  DESCRIBED,
  lane,
  NO_LANES,
  SETTLED,
  snapshot,
} from "./syncStatus.testFixtures";
import { describeSyncStatus, resolveSyncStatus } from "./syncStatusModel";
import {
  describeSyncStatusDetails,
  listSyncStatusActions,
} from "./syncStatusPopoverModel";

// Each test here covers a row of issue #3160's gaps table: a situation the
// tray reported as plain green before it read the sync lanes, the download
// queue, and every sync hold.

function pendingDownload(lastError: string | null): PendingDownloadQueueItem {
  return {
    documentId: "remote-note",
    lastError,
    localId: "note",
    objectKind: "document",
    reason: "initial",
    title: "Note",
  };
}

test("a first sign-in still pulling content reads as syncing, with what is left", () => {
  expect(resolveSyncStatus({ ...SETTLED, syncActive: true })).toBe("syncing");
  expect(
    describeSyncStatus({ ...DESCRIBED, status: "syncing", syncActive: true }),
  ).toBe("All changes synced, syncing updates…");
  const downloads = summarizeDownloadQueue({
    items: Array.from({ length: 42 }, () => pendingDownload(null)),
    read: 1,
    status: "ready",
  });
  expect(
    describeSyncStatusDetails({
      unavailableReason: null,
      downloads,
      lanes: { ...NO_LANES, running: 3 },
      pausedOrganizationCount: 0,
      pendingWriteCount: 0,
      uploadingFileCount: 0,
    }),
  ).toEqual([
    "Changes to upload: none",
    "42 items to download",
    "3 sync tasks running",
  ]);
});

test("a failed or abandoned sync task warns with its recorded error", () => {
  const lanes = summarizeSyncLanes(
    snapshot([
      lane({ key: "documents:ok" }),
      lane({
        key: "documents:photos",
        lastAction: "failed",
        lastError: "Blob download failed (503)",
        status: "error",
      }),
      lane({ key: "documents:stuck", runAbandoned: true, status: "running" }),
    ]),
  );
  expect(lanes).toEqual({
    failed: 2,
    firstError: "Blob download failed (503)",
    running: 0,
  });
  expect(resolveSyncStatus({ ...SETTLED, failedLaneCount: 2 })).toBe("error");
  expect(
    describeSyncStatus({
      ...DESCRIBED,
      status: "error",
      failedLaneCount: 2,
      firstLaneError: lanes.firstError,
    }),
  ).toBe("2 sync tasks failed — Blob download failed (503)");
  expect(
    describeSyncStatus({
      ...DESCRIBED,
      status: "error",
      failedLaneCount: 1,
      firstLaneError: null,
    }),
  ).toBe("1 sync task failed");
  // Failed writes, the user's own data, are named first.
  expect(
    describeSyncStatus({
      ...DESCRIBED,
      status: "error",
      failedWriteCount: 1,
      firstWriteError: "Write access denied by the server (403)",
      failedLaneCount: 2,
      firstLaneError: lanes.firstError,
    }),
  ).toBe("1 change failed to sync — Write access denied by the server (403)");
});

test("a lane that keeps failing stays failed while its retry waits or runs", () => {
  const retrying = summarizeSyncLanes(
    snapshot([
      lane({
        key: "documents:queued-retry",
        lastAction: "failed",
        lastError: "Sync failed (500)",
        requested: true,
        status: "queued",
      }),
      lane({
        key: "documents:running-retry",
        lastAction: "started",
        lastError: "Blob download failed (503)",
        running: true,
        status: "running",
      }),
      // A run that completed cleared its error, whatever is queued after it.
      lane({ key: "documents:recovered", requested: true, status: "queued" }),
    ]),
  );
  expect(retrying).toEqual({
    failed: 2,
    firstError: "Sync failed (500)",
    running: 1,
  });
});

test("a failed upload is left to the write queue, not counted as a failed lane", () => {
  // The SDK keeps a settled upload lane as history that no sync request
  // re-runs, so counting it would pin the warning until it is evicted.
  expect(
    summarizeSyncLanes(
      snapshot([
        lane({
          blobStorageKey: "blob-1",
          key: "upload:blob-1",
          lastAction: "failed",
          lastError: "Upload failed (500)",
          phase: "blob",
          status: "error",
        }),
      ]),
    ),
  ).toEqual({ failed: 0, firstError: null, running: 0 });
});

test("offline hides lane failures and activity from the status and the popover", () => {
  const lanes = { failed: 2, firstError: "Sync failed (500)", running: 1 };
  const holds = {
    dbReady: true,
    lanes,
    online: true,
    pausedOrganizationIds: new Set<string>(),
    writeOrganizationIds: [],
  };
  expect(selectSyncHolds(holds)).toEqual({
    lanes,
    laneActive: true,
    pausedOrganizationCount: 0,
    writesPaused: false,
  });
  // Offline, sync tasks fail or wait as a matter of course, so the popover
  // gets the same empty summary the status line reads.
  expect(selectSyncHolds({ ...holds, online: false })).toEqual({
    lanes: NO_LANES,
    laneActive: false,
    pausedOrganizationCount: 0,
    writesPaused: false,
  });
  expect(
    listSyncStatusActions({
      unavailableReason: null,
      billingBlock: null,
      canSync: false,
      downloads: { failed: 0, firstError: null, pending: 0, status: "read" },
      lanes: selectSyncHolds({ ...holds, online: false }).lanes,
      pendingWriteCount: 0,
      queueReadFailed: false,
      uploadingFileCount: 0,
    }),
  ).toEqual([]);
  // A closed database runs nothing worth showing as activity.
  expect(selectSyncHolds({ ...holds, dbReady: false }).laneActive).toBe(false);
});

test("a pending download with a recorded error is named in the popover", () => {
  const downloads = summarizeDownloadQueue({
    items: [pendingDownload("Unable to fetch content"), pendingDownload(null)],
    read: 1,
    status: "ready",
  });
  expect(downloads).toEqual({
    failed: 1,
    firstError: "Unable to fetch content",
    pending: 2,
    status: "read",
  });
  expect(
    describeSyncStatusDetails({
      unavailableReason: null,
      downloads,
      lanes: NO_LANES,
      pausedOrganizationCount: 0,
      pendingWriteCount: 1,
      uploadingFileCount: 2,
    }),
  ).toEqual([
    "Changes to upload: 1",
    "2 items to download",
    "1 download failed — Unable to fetch content",
    "Uploading 2 files",
  ]);
  expect(
    describeSyncStatusDetails({
      unavailableReason: null,
      downloads: summarizeDownloadQueue({
        items: [],
        message: "Storage unavailable",
        read: 2,
        status: "failed",
      }),
      lanes: NO_LANES,
      pausedOrganizationCount: 0,
      pendingWriteCount: 0,
      uploadingFileCount: 0,
    }),
  ).toEqual([
    "Changes to upload: none",
    "Downloads: unable to check — Storage unavailable",
  ]);
});

test("offline with nothing queued says so", () => {
  expect(
    describeSyncStatus({ ...DESCRIBED, status: "synced", online: false }),
  ).toBe("All changes synced (offline)");
});

test("a paused organization is named with nothing queued for it", () => {
  expect(
    describeSyncStatus({ ...DESCRIBED, status: "synced", syncPaused: true }),
  ).toBe("All changes synced (sync is paused for an organization)");
});

test("a write being flushed reads differently from one that is waiting", () => {
  const pending = {
    ...DESCRIBED,
    status: "pending",
    pendingWriteCount: 3,
  } as const;
  expect(describeSyncStatus({ ...pending, syncActive: true })).toBe(
    "Syncing 3 changes…",
  );
  expect(
    describeSyncStatus({ ...pending, pendingWriteCount: 1, syncActive: true }),
  ).toBe("Syncing 1 change…");
  expect(describeSyncStatus(pending)).toBe("3 changes not yet synced");
  // Held writes are not being sent, whatever other lanes run.
  expect(
    describeSyncStatus({
      ...pending,
      syncActive: true,
      syncPaused: true,
      writesPaused: true,
    }),
  ).toBe("3 changes not yet synced (sync is paused for an organization)");
  // Sync running does not hide unflushed data: the glyph stays red.
  expect(
    resolveSyncStatus({ ...SETTLED, pendingWriteCount: 3, syncActive: true }),
  ).toBe("pending");
});

test("the popover offers Sync now and a view for each line that needs one", () => {
  const quiet = {
    unavailableReason: null,
    billingBlock: null,
    canSync: true,
    downloads: { failed: 0, firstError: null, pending: 0, status: "read" },
    lanes: NO_LANES,
    pendingWriteCount: 0,
    queueReadFailed: false,
    uploadingFileCount: 0,
  } as const;
  expect(listSyncStatusActions(quiet)).toEqual(["sync-now"]);
  expect(listSyncStatusActions({ ...quiet, canSync: false })).toEqual([]);
  expect(
    listSyncStatusActions({
      ...quiet,
      downloads: { failed: 1, firstError: "x", pending: 4, status: "read" },
      lanes: { failed: 1, firstError: "x", running: 0 },
      pendingWriteCount: 2,
      uploadingFileCount: 1,
    }),
  ).toEqual(["sync-now", "write-queue", "downloads", "uploads", "sync-lanes"]);
  // The active organization's billing replaces Sync now, which it would refuse.
  expect(
    listSyncStatusActions({
      ...quiet,
      billingBlock: "active",
      downloads: { message: "Storage unavailable", status: "unreadable" },
      queueReadFailed: true,
    }),
  ).toEqual(["billing", "write-queue", "downloads"]);
});
