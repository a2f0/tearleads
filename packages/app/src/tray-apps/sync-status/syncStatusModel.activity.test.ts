import { expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  PendingDownloadQueueItem,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import {
  summarizeDownloadQueue,
  summarizeSyncLanes,
} from "./syncActivityModel";
import { describeSyncStatus, resolveSyncStatus } from "./syncStatusModel";
import {
  describeSyncStatusDetails,
  listSyncStatusActions,
} from "./syncStatusPopoverModel";

// Each test here covers a row of issue #3160's gaps table: a situation the
// tray reported as plain green before it read the sync lanes, the download
// queue, and every sync hold.

const SETTLED = {
  billingNeedsAttention: false,
  otherOrganizationBillingBlocked: false,
  ready: true,
  pendingWriteCount: 0,
  failedWriteCount: 0,
  queueReadError: null,
  failedLaneCount: 0,
  syncActive: false,
} as const;

const DESCRIBED = {
  pendingWriteCount: 0,
  failedWriteCount: 0,
  firstWriteError: null,
  queueReadError: null,
  failedLaneCount: 0,
  firstLaneError: null,
  syncActive: false,
  online: true,
  syncPaused: false,
  billingStatus: null,
  billingBlockScope: "active",
} as const;

const NO_LANES = { failed: 0, firstError: null, running: 0 } as const;

function lane(overrides: Partial<SyncLaneSnapshot>): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: 0,
    key: "documents:note",
    label: "Note",
    lastAction: "completed",
    lastActionAt: "2026-11-22T00:00:00.000Z",
    lastCompletedAt: "2026-11-22T00:00:00.000Z",
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: null,
    lastStartedAt: null,
    phase: "document",
    progress: null,
    registrationIndex: 0,
    requestCount: 1,
    requested: false,
    runAbandoned: false,
    runCount: 1,
    runDurations: null,
    running: false,
    status: "complete",
    ...overrides,
  };
}

function snapshot(lanes: SyncLaneSnapshot[]): DomainSyncSnapshot {
  return {
    hasPendingWork: lanes.some((entry) => entry.running || entry.requested),
    lanes,
    pumpActive: lanes.some((entry) => entry.running),
    updatedAt: "2026-11-22T00:00:00.000Z",
  };
}

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
      downloads,
      lanes: { ...NO_LANES, running: 3 },
      pendingWriteCount: 0,
      uploadingFileCount: 0,
    }),
  ).toEqual([
    "Changes to upload: none",
    "Downloading 42 items",
    "3 sync tasks running",
  ]);
});

test("a failed or abandoned sync task warns with its recorded error", () => {
  const lanes = summarizeSyncLanes(
    snapshot([
      lane({ key: "documents:ok" }),
      lane({
        key: "blobs:photo",
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
      downloads,
      lanes: NO_LANES,
      pendingWriteCount: 1,
      uploadingFileCount: 2,
    }),
  ).toEqual([
    "Changes to upload: 1",
    "Downloading 2 items",
    "1 download failed — Unable to fetch content",
    "Uploading 2 files",
  ]);
  expect(
    describeSyncStatusDetails({
      downloads: summarizeDownloadQueue({
        items: [],
        message: "Storage unavailable",
        read: 2,
        status: "failed",
      }),
      lanes: NO_LANES,
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
  // Sync running does not hide unflushed data: the glyph stays red.
  expect(
    resolveSyncStatus({ ...SETTLED, pendingWriteCount: 3, syncActive: true }),
  ).toBe("pending");
});

test("the popover offers Sync now and a view for each line that needs one", () => {
  const quiet = {
    billingBlocked: false,
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
  // Billing replaces Sync now, which would only be refused.
  expect(
    listSyncStatusActions({
      ...quiet,
      billingBlocked: true,
      downloads: { message: "Storage unavailable", status: "unreadable" },
      queueReadFailed: true,
    }),
  ).toEqual(["billing", "write-queue", "downloads"]);
});
