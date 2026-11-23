import type { SyncLaneSnapshot, SyncLaneStatus } from "@tearleads/client-sdk";
import type { ExplorerUploadItem } from "../../../../stores/explorer/explorerUploadItemMachine";
import {
  EXPLORER_LABELS,
  getExplorerSyncLaneUploadProgressLabel,
} from "../../labels";
import {
  type ExplorerTransferProgress,
  getExplorerTransferStatusPercent,
} from "./ExplorerTransferCells";

type SyncLaneProgress = NonNullable<SyncLaneSnapshot["progress"]>;

// The row-facing status: the item's own lifecycle, refined for "imported"
// items by the document's sync lane so the tail of an upload (local ingest
// done, bytes still moving) stays visible until the SDK confirms it synced.
export type ExplorerUploadDerivedStatus =
  | Exclude<ExplorerUploadItem["status"], "imported">
  | "pending-sync"
  | "sync-queued"
  | "uploading"
  | "sync-failed";

export function deriveExplorerUploadItemStatus(
  item: ExplorerUploadItem,
  lane: SyncLaneSnapshot | undefined,
): ExplorerUploadDerivedStatus {
  if (item.status !== "imported") {
    return item.status;
  }
  switch (lane?.status) {
    case "queued":
      return "sync-queued";
    case "running":
      return "uploading";
    case "error":
      return "sync-failed";
    default:
      // A completed lane still waits for the SDK to confirm nothing is left.
      return "pending-sync";
  }
}

const UPLOAD_STATUS_DISPLAY: Record<
  ExplorerUploadDerivedStatus,
  { label: string; status: SyncLaneStatus }
> = {
  cancelled: { label: EXPLORER_LABELS.uploadsCancelledStatus, status: "idle" },
  failed: { label: EXPLORER_LABELS.uploadsFailedStatus, status: "error" },
  importing: {
    label: EXPLORER_LABELS.uploadsImportingStatus,
    status: "running",
  },
  "pending-sync": {
    label: EXPLORER_LABELS.uploadsPendingSyncStatus,
    status: "queued",
  },
  queued: { label: EXPLORER_LABELS.uploadsQueuedStatus, status: "queued" },
  // Deleted before its upload was confirmed.
  removed: { label: EXPLORER_LABELS.uploadsRemovedStatus, status: "idle" },
  "sync-failed": {
    label: EXPLORER_LABELS.uploadsSyncFailedStatus,
    status: "error",
  },
  "sync-queued": {
    label: EXPLORER_LABELS.uploadsSyncQueuedStatus,
    status: "queued",
  },
  uploaded: {
    label: EXPLORER_LABELS.syncLanesStatusComplete,
    status: "complete",
  },
  uploading: {
    label: EXPLORER_LABELS.uploadsUploadingStatus,
    status: "running",
  },
};

const OUTSTANDING_UPLOAD_STATUSES: ReadonlySet<ExplorerUploadDerivedStatus> =
  new Set(["queued", "importing", "pending-sync", "sync-queued", "uploading"]);

/** Whether a file is still on its way: importing, or imported and unconfirmed. */
export function isOutstandingUploadStatus(
  status: ExplorerUploadDerivedStatus,
): boolean {
  return OUTSTANDING_UPLOAD_STATUSES.has(status);
}

/** The lanes an upload's row reads, indexed once for every row. */
export interface UploadLaneIndex {
  readonly blobLanesByStorageKey: ReadonlyMap<string, SyncLaneSnapshot>;
  readonly lanesByKey: ReadonlyMap<string, SyncLaneSnapshot>;
}

export function indexUploadLanes(
  lanes: ReadonlyArray<SyncLaneSnapshot>,
): UploadLaneIndex {
  return {
    blobLanesByStorageKey: new Map(
      lanes.flatMap((lane) =>
        lane.blobStorageKey === null ? [] : [[lane.blobStorageKey, lane]],
      ),
    ),
    lanesByKey: new Map(lanes.map((lane) => [lane.key, lane])),
  };
}

/** The summed byte progress of the item's attachment uploads, if any began. */
function getUploadByteProgress(
  item: ExplorerUploadItem,
  blobLanesByStorageKey: ReadonlyMap<string, SyncLaneSnapshot>,
): SyncLaneProgress | null {
  const reported = item.storageKeys.flatMap((storageKey) => {
    const progress = blobLanesByStorageKey.get(storageKey)?.progress;
    return progress ? [progress] : [];
  });
  const total = reported.reduce<SyncLaneProgress>(
    (sum, progress) => ({
      bytesTotal: sum.bytesTotal + progress.bytesTotal,
      bytesUploaded: sum.bytesUploaded + progress.bytesUploaded,
      partsCompleted: sum.partsCompleted + progress.partsCompleted,
      partsTotal: sum.partsTotal + progress.partsTotal,
    }),
    { bytesTotal: 0, bytesUploaded: 0, partsCompleted: 0, partsTotal: 0 },
  );
  return total.bytesTotal > 0 ? total : null;
}

/** How a file's upload reads: its derived status and its progress. */
export function getExplorerUploadTransfer(
  item: ExplorerUploadItem,
  lanes: UploadLaneIndex,
): { status: ExplorerUploadDerivedStatus; transfer: ExplorerTransferProgress } {
  const lane = item.localId
    ? lanes.lanesByKey.get(`documents:${item.localId}`)
    : undefined;
  const status = deriveExplorerUploadItemStatus(item, lane);
  const display = UPLOAD_STATUS_DISPLAY[status];
  const byteProgress = getUploadByteProgress(item, lanes.blobLanesByStorageKey);
  const laneError =
    item.status === "imported" ? (lane?.lastError ?? null) : null;
  // Transferred bytes drive the bar while the item awaits confirmation; the
  // Sync Lanes status fill stands in when no attachment upload reported.
  const showBytes = item.status === "imported" && byteProgress !== null;
  return {
    status,
    transfer: {
      detail:
        item.error ??
        laneError ??
        (showBytes
          ? getExplorerSyncLaneUploadProgressLabel(byteProgress)
          : null),
      label: display.label,
      percent: showBytes
        ? Math.round(
            (byteProgress.bytesUploaded / byteProgress.bytesTotal) * 100,
          )
        : getExplorerTransferStatusPercent(display.status),
      status: display.status,
    },
  };
}
