import { discardPendingWrite } from "../../../workflows/container-contents/discardPendingWrite";
import { unregisterDocumentStore } from "../registry";
import { type DocumentStoreState, markDocumentStoreRemoved } from "./state";

/**
 * Discard this document's queued local writes through its live store: run the
 * write-queue discard workflow, then clear the in-memory store state — the
 * same teardown an upstream deletion performs — and drop the store from the
 * registry so a re-discovered server copy opens through a fresh store instead
 * of resolving to this cleared one.
 *
 * Serialization: refused while a sync pass is in flight (its finalization
 * could re-persist the record after the deletion), and the teardown runs
 * behind the store's write chain so a queued mutation persists before the
 * deletion decides — not after it, which would silently re-create the rows.
 */
export async function discardDocumentStoreLocalState(
  state: DocumentStoreState,
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready" || state.snapshot.syncing) {
    return false;
  }

  const task = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      // Re-check under the chain: a write queued ahead of this task may have
      // kicked off a sync pass while the chain drained.
      if (state.snapshot.syncing) {
        return false;
      }
      const documentId = state.record?.documentId ?? null;
      const discarded = await discardPendingWrite({
        documentProjectors: state.runtime.infra.documentProjectors,
        execSql: state.runtime.infra.execSql,
        localId: state.localId,
        namespace: null,
        objectKind: "document",
      });
      if (!discarded) {
        return false;
      }

      markDocumentStoreRemoved(state);
      unregisterDocumentStore(
        state.runtime.state.domainScope,
        state.localId,
        documentId,
      );
      state.runtime.util.log(
        `Documents: discarded queued local writes for ${state.localId}.`,
      );
      return true;
    });
  // Keep the chain unbroken for later writes even if the discard rejects.
  state.writeChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
