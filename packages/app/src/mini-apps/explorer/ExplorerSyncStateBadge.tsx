import type { ContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  EXPLORER_LABELS,
  getExplorerSyncBlobCountLabel,
  getExplorerSyncPendingBlobCountLabel,
  getExplorerSyncPendingUpdateCountLabel,
} from "./labels";

function getExplorerSyncStateLabel(
  syncState: ContainerDocumentObjectSyncState,
): string {
  if (syncState.status === "synced") {
    return EXPLORER_LABELS.syncStateSynced;
  }

  if (syncState.status === "error") {
    return EXPLORER_LABELS.syncStateError;
  }

  if (syncState.pendingAttachmentCount > 0) {
    return getExplorerSyncBlobCountLabel(syncState.pendingAttachmentCount);
  }

  if (syncState.status === "local-only") {
    return EXPLORER_LABELS.syncStateLocal;
  }

  return EXPLORER_LABELS.syncStatePending;
}

function getExplorerSyncStateTitle(
  syncState: ContainerDocumentObjectSyncState,
  online: boolean,
): string {
  const details: string[] = [];

  if (!online && syncState.status !== "synced") {
    details.push(EXPLORER_LABELS.syncStateOffline);
  }
  if (syncState.pendingUpdateCount > 0) {
    details.push(
      getExplorerSyncPendingUpdateCountLabel(syncState.pendingUpdateCount),
    );
  }
  if (syncState.pendingAttachmentCount > 0) {
    details.push(
      getExplorerSyncPendingBlobCountLabel(
        syncState.pendingAttachmentCount,
        syncState.pendingAttachmentBytes,
      ),
    );
  }
  if (syncState.lastError) {
    details.push(syncState.lastError);
  }

  const label = getExplorerSyncStateLabel(syncState);
  return details.length > 0 ? `${label}: ${details.join(", ")}` : label;
}

export function ExplorerSyncStateBadge(params: {
  online: boolean;
  reserveSpace?: boolean | undefined;
  showSynced?: boolean | undefined;
  syncState: ContainerDocumentObjectSyncState;
}) {
  const {
    online,
    reserveSpace = false,
    showSynced = false,
    syncState,
  } = params;
  const label = getExplorerSyncStateLabel(syncState);
  const badgeClassName = `explorer-sync-badge explorer-sync-badge--${syncState.status}${
    reserveSpace ? " explorer-sync-badge--reserved" : ""
  }`;
  if (!showSynced && syncState.status === "synced") {
    if (reserveSpace) {
      return (
        <span
          aria-hidden="true"
          className={`${badgeClassName} explorer-sync-badge--placeholder`}
          data-label={label}
        />
      );
    }

    return null;
  }

  const title = getExplorerSyncStateTitle(syncState, online);

  return (
    <span
      aria-label={title}
      className={badgeClassName}
      data-label={label}
      role="img"
      title={title}
    />
  );
}
