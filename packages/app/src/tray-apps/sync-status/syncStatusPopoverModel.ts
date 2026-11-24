import type {
  DownloadQueueSummary,
  SyncLaneSummary,
} from "./syncActivityModel";
import type {
  BillingBlockScope,
  SyncUnavailableReason,
} from "./syncStatusModel";

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
  syncPausedFor: "Sync paused for",
  organization: ["organization", "organizations"],
} as const;

// What the user can do when this device's data cannot be read at all; until
// then there is no queue to count in either direction.
const UNAVAILABLE_LABELS: Record<SyncUnavailableReason, string> = {
  "no-identity": "Create or restore an identity to start syncing.",
  locked: "Unlock this device to read and sync its data.",
};

function counted(
  count: number,
  [one, other]: readonly [string, string],
): string {
  return `${count} ${count === 1 ? one : other}`;
}

interface SyncStatusDetailsInput {
  /** Why nothing on this device can sync until the user acts, if so. */
  readonly unavailableReason: SyncUnavailableReason | null;
  readonly pendingWriteCount: number;
  readonly downloads: DownloadQueueSummary;
  readonly lanes: SyncLaneSummary;
  /** Files imported into the Explorer that have not finished uploading. */
  readonly uploadingFileCount: number;
  /** Organizations whose sync is paused on this device. */
  readonly pausedOrganizationCount: number;
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
 * the Explorer is still uploading, sync tasks running, and organizations
 * whose sync is paused (the status line names a pause only where it holds
 * the queued writes). Failed sync tasks are named by the status line itself.
 * While this device's data cannot be read, one line says what would let it
 * sync instead.
 */
export function describeSyncStatusDetails(
  input: SyncStatusDetailsInput,
): ReadonlyArray<string> {
  if (input.unavailableReason !== null) {
    return [UNAVAILABLE_LABELS[input.unavailableReason]];
  }
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
  if (input.pausedOrganizationCount > 0) {
    lines.push(
      `${DETAIL_LABELS.syncPausedFor} ${counted(input.pausedOrganizationCount, DETAIL_LABELS.organization)}`,
    );
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
  /** Why nothing on this device can sync until the user acts, if so. */
  readonly unavailableReason: SyncUnavailableReason | null;
  /** Online, signed in, and the database open: a sync request can run. */
  readonly canSync: boolean;
  /** Whose billing paused sync, if any organization's did. */
  readonly billingBlock: BillingBlockScope | null;
  readonly pendingWriteCount: number;
  readonly queueReadFailed: boolean;
  readonly downloads: DownloadQueueSummary;
  readonly lanes: SyncLaneSummary;
  readonly uploadingFileCount: number;
}

/**
 * The popover's actions: Sync now while a request can run and the active
 * organization's billing allows it (another organization's block leaves the
 * rest to sync), Update billing when billing paused sync, and a link into each Explorer
 * view that explains a line above it (the write queue when it holds or could
 * not read changes, Downloads when content waits or could not be read,
 * Uploads while files are uploading, and Sync Lanes while tasks run or fail).
 * None while this device's data cannot be read.
 */
export function listSyncStatusActions(
  input: SyncStatusActionsInput,
): ReadonlyArray<SyncStatusActionId> {
  // No view can show a queue this device cannot read.
  if (input.unavailableReason !== null) return [];
  const actions: SyncStatusActionId[] = [];
  if (input.canSync && input.billingBlock !== "active")
    actions.push("sync-now");
  if (input.billingBlock !== null) actions.push("billing");
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
