import { getOrCreateOrganizationSyncPauses } from "../../../../workflows/sync";
import { listPendingUpdates } from "../persistence";
import type { DocumentStoreState } from "../state";

/**
 * Whether this document belongs to a paused organization and was kept only
 * because this store held it. Synchronous, so ordinary documents pay nothing.
 */
export function isHeldForPausedOrganization(
  state: DocumentStoreState,
): boolean {
  return getOrCreateOrganizationSyncPauses(
    state.runtime.state.domainScope,
  ).isDocumentHeld(state.localId);
}

/**
 * Whether a held document has nothing left to upload. Its sync rounds would
 * then only pull remote changes the pause keeps off this device, so the store
 * skips them.
 */
export async function hasNothingToUpload(
  state: DocumentStoreState,
): Promise<boolean> {
  if (state.pendingLocalWrites > 0 || state.pendingAttachments.length > 0) {
    return false;
  }
  return (await listPendingUpdates(state)).length === 0;
}
