import { reloadDocumentFromDurableHistory } from "./durableDocumentReload";
import type { DocumentStoreState } from "./state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";

/**
 * An enqueue identity CAS can lose before the following record persist gets a
 * chance to observe the replacement. Rebuild from durable history immediately
 * and invalidate every local write that was queued against the old live doc;
 * none of those mutations may be replayed into the replacement identity.
 */
export async function rebaseDocumentAfterPendingUpdateRefusal(
  state: DocumentStoreState,
  expectedGeneration: DocumentStoreSyncGeneration,
): Promise<boolean> {
  return reloadDocumentFromDurableHistory({
    expectedGeneration,
    preserveQueuedWritesWhenIdentityMatches: false,
    state,
  });
}
