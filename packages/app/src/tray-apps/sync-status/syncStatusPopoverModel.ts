import type {
  DownloadQueueSummary,
  SyncLaneSummary,
} from "./syncActivityModel";

const DETAIL_LABELS = {
  changesToUpload: "Changes to upload:",
  none: "none",
  downloadsLoading: "Downloads: checking…",
  downloadsUnreadable: "Downloads: unable to check",
  downloadsNone: "Downloads: none waiting",
  item: ["item to download", "items to download"],
  downloadFailed: ["download failed", "downloads failed"],
  uploading: "Uploading",
  file: ["file", "files"],
  syncTaskRunning: ["sync task running", "sync tasks running"],
} as const;

function counted(
  count: number,
  [one, other]: readonly [string, string],
): string {
  return `${count} ${count === 1 ? one : other}`;
}

interface SyncStatusDetailsInput {
  readonly pendingWriteCount: number;
  readonly downloads: DownloadQueueSummary;
  readonly lanes: SyncLaneSummary;
  /** Files imported into the Explorer that have not finished uploading. */
  readonly uploadingFileCount: number;
}

function describeDownloads(downloads: DownloadQueueSummary): string[] {
  switch (downloads.status) {
    case "loading":
      return [DETAIL_LABELS.downloadsLoading];
    case "unreadable":
      return [`${DETAIL_LABELS.downloadsUnreadable} — ${downloads.message}`];
    case "read": {
      if (downloads.pending === 0) return [DETAIL_LABELS.downloadsNone];
      const lines = [
        // Not "Downloading": offline or paused, nothing is.
        counted(downloads.pending, DETAIL_LABELS.item),
      ];
      if (downloads.failed > 0) {
        const failed = counted(downloads.failed, DETAIL_LABELS.downloadFailed);
        lines.push(
          downloads.firstError ? `${failed} — ${downloads.firstError}` : failed,
        );
      }
      return lines;
    }
  }
}

/**
 * The popover's lines below the status, one direction each: local changes
 * waiting to upload, content waiting to download (and why it failed), files
 * the Explorer is still uploading, and sync tasks running. Failed sync tasks
 * are named by the status line itself.
 */
export function describeSyncStatusDetails(
  input: SyncStatusDetailsInput,
): ReadonlyArray<string> {
  const lines = [
    `${DETAIL_LABELS.changesToUpload} ${
      input.pendingWriteCount === 0
        ? DETAIL_LABELS.none
        : String(input.pendingWriteCount)
    }`,
    ...describeDownloads(input.downloads),
  ];
  if (input.uploadingFileCount > 0) {
    lines.push(
      `${DETAIL_LABELS.uploading} ${counted(input.uploadingFileCount, DETAIL_LABELS.file)}`,
    );
  }
  if (input.lanes.running > 0) {
    lines.push(counted(input.lanes.running, DETAIL_LABELS.syncTaskRunning));
  }
  return lines;
}

/** What the popover can offer, in the order it lists them. */
export type SyncStatusActionId =
  | "sync-now"
  | "billing"
  | "write-queue"
  | "downloads"
  | "uploads"
  | "sync-lanes";

interface SyncStatusActionsInput {
  /** Online, signed in, and the database open: a sync request can run. */
  readonly canSync: boolean;
  readonly billingBlocked: boolean;
  readonly pendingWriteCount: number;
  readonly queueReadFailed: boolean;
  readonly downloads: DownloadQueueSummary;
  readonly lanes: SyncLaneSummary;
  readonly uploadingFileCount: number;
}

/**
 * The popover's actions: Sync now while a request can run and billing allows
 * it, Update billing when billing paused sync, and a link into each Explorer
 * view that explains a line above it (the write queue when it holds or could
 * not read changes, Downloads when content waits or could not be read,
 * Uploads while files are uploading, and Sync Lanes while tasks run or fail).
 */
export function listSyncStatusActions(
  input: SyncStatusActionsInput,
): ReadonlyArray<SyncStatusActionId> {
  const actions: SyncStatusActionId[] = [];
  if (input.canSync && !input.billingBlocked) actions.push("sync-now");
  if (input.billingBlocked) actions.push("billing");
  if (input.pendingWriteCount > 0 || input.queueReadFailed)
    actions.push("write-queue");
  if (
    input.downloads.status === "unreadable" ||
    (input.downloads.status === "read" && input.downloads.pending > 0)
  )
    actions.push("downloads");
  if (input.uploadingFileCount > 0) actions.push("uploads");
  if (input.lanes.running > 0 || input.lanes.failed > 0)
    actions.push("sync-lanes");
  return actions;
}
