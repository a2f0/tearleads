import type {
  ContainerDocumentObjectSyncState,
  ContainerDocumentObjectSyncStatus,
} from "@symcrypt/client-sdk";
import {
  SyncGlyph,
  type SyncGlyphTone,
} from "../../../components/shared/SyncGlyph";
import {
  EXPLORER_LABELS,
  getExplorerSyncBlobCountLabel,
  getExplorerSyncPendingBlobCountLabel,
  getExplorerSyncPendingUpdateCountLabel,
} from "../labels";

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

// Fold the per-object states onto the shared glyph's tones: "local-only" is
// unflushed data just like "pending", so both take the red dot, and a recorded
// failure takes the warning glyph — exactly what the footer tray shows for the
// same conditions across the whole write queue.
function getExplorerSyncGlyphTone(
  status: ContainerDocumentObjectSyncStatus,
): SyncGlyphTone {
  switch (status) {
    case "synced":
      return "synced";
    case "error":
      return "error";
    case "local-only":
    case "pending":
      return "pending";
  }
}

// A per-object sync indicator, drawn in the same dot/warning vocabulary as the
// footer tray. The state reads from the tooltip and the accessible name (which
// carry the counts and any error), so the glyph itself stays a single mark and
// never competes with the name it sits beside.
export function ExplorerSyncStateBadge(params: {
  online: boolean;
  syncState: ContainerDocumentObjectSyncState;
}) {
  const { online, syncState } = params;
  const title = getExplorerSyncStateTitle(syncState, online);

  return (
    <span
      aria-label={title}
      className="explorer-sync-badge"
      role="img"
      title={title}
    >
      <SyncGlyph tone={getExplorerSyncGlyphTone(syncState.status)} />
    </span>
  );
}
