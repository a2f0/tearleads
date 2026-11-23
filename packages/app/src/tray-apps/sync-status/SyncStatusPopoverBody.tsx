import { useMemo } from "react";
import {
  SyncStatusPopover,
  type SyncStatusPopoverAction,
} from "./SyncStatusPopover";
import type { DownloadQueueSummary } from "./syncActivityModel";
import {
  describeSyncStatusDetails,
  listSyncStatusActions,
  type SyncStatusActionId,
} from "./syncStatusPopoverModel";
import type { SyncStatusResult } from "./useSyncStatus";

const SYNC_STATUS_ACTION_LABELS: Record<SyncStatusActionId, string> = {
  "sync-now": "Sync now",
  // Jumps to the Org Manager's Billing view — where the "Update billing to
  // resume" instruction in the billing-paused status text can actually be
  // done. That view bills the *active* org; when the block is another
  // organization's, its org switcher is how the lapsed org is reached.
  billing: "Update billing",
  "write-queue": "View write queue",
  downloads: "View downloads",
  uploads: "View uploads",
  "sync-lanes": "View sync lanes",
};

/** A view the popover opens, by app id, since a tray app imports no mini-app. */
export interface SyncStatusViewRequest {
  readonly appId: "explorer" | "org-manager";
  readonly pathSegments: ReadonlyArray<string>;
}

type SyncStatusViewActionId = Exclude<SyncStatusActionId, "sync-now">;

// Each path is the one the destination itself writes for that view. Uploads
// and the write queue share Explorer's Outgoing table; downloads are its
// Incoming tab.
const VIEW_DESTINATIONS: Record<SyncStatusViewActionId, SyncStatusViewRequest> =
  {
    billing: { appId: "org-manager", pathSegments: ["billing"] },
    downloads: { appId: "explorer", pathSegments: ["incoming"] },
    "sync-lanes": { appId: "explorer", pathSegments: ["sync"] },
    uploads: { appId: "explorer", pathSegments: ["outgoing"] },
    "write-queue": { appId: "explorer", pathSegments: ["outgoing"] },
  };

/**
 * The open popover without the SDK or navigation: the status, what waits in
 * each direction, and the actions that apply, each closing the popover once
 * it runs.
 */
export function SyncStatusPopoverBody({
  canSync,
  downloads,
  onClose,
  onOpenView,
  onSyncNow,
  sync,
  uploadingFileCount,
}: {
  /** Online, signed in, and the database open: a sync request can run. */
  canSync: boolean;
  downloads: DownloadQueueSummary;
  onClose: () => void;
  onOpenView: (request: SyncStatusViewRequest) => void;
  onSyncNow: () => void;
  sync: SyncStatusResult;
  uploadingFileCount: number;
}) {
  const actions = useMemo(
    () =>
      listSyncStatusActions({
        billingBlock: sync.billingBlock,
        canSync,
        downloads,
        lanes: sync.lanes,
        pendingWriteCount: sync.pendingWriteCount,
        queueReadFailed: sync.queueReadFailed,
        uploadingFileCount,
      }).map(
        (id): SyncStatusPopoverAction => ({
          id,
          label: SYNC_STATUS_ACTION_LABELS[id],
          onSelect: () => {
            if (id === "sync-now") onSyncNow();
            else onOpenView(VIEW_DESTINATIONS[id]);
            onClose();
          },
        }),
      ),
    [
      canSync,
      downloads,
      onClose,
      onOpenView,
      onSyncNow,
      sync,
      uploadingFileCount,
    ],
  );
  const details = describeSyncStatusDetails({
    downloads,
    lanes: sync.lanes,
    pausedOrganizationCount: sync.pausedOrganizationCount,
    pendingWriteCount: sync.pendingWriteCount,
    uploadingFileCount,
  });
  return (
    <SyncStatusPopover actions={actions} details={details} title={sync.title} />
  );
}
