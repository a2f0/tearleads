import { discardPendingWrite } from "../../../workflows/container-contents/discardPendingWrite";
import { type DocumentStoreState, markDocumentStoreRemoved } from "./state";

/**
 * Discard this document's queued local writes through its live store: run the
 * write-queue discard workflow, then clear the in-memory store state — the
 * same teardown an upstream deletion performs — so the store's next persist
 * cannot re-create the deleted rows. The store (and its sync lane) stays
 * registered but empty-initialized; a synced document re-materializes through
 * discovery with server state.
 */
export async function discardDocumentStoreLocalState(
  state: DocumentStoreState,
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready") {
    return false;
  }

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
  state.runtime.util.log(
    `Documents: discarded queued local writes for ${state.localId}.`,
  );
  return true;
}
