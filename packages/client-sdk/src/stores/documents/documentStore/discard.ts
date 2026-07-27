import {
  clearDocumentSyncFailure,
  DOCUMENTS_APP_KIND,
  deletePersistedDocument,
} from "../../../workflows/documents";
import { chainIdentityWrite } from "./identityWriteChain";
import { type DocumentStoreState, markDocumentStoreRemoved } from "./state";

/**
 * User-initiated escape hatch for a document whose queued local writes can no
 * longer sync (e.g. an outgoing queue whose update ids conflict forever):
 * tear down every locally persisted trace of the document — record, pending
 * updates, projections, attachments, and durable history — so container
 * priming re-creates it from the server copy. Restricted to documents that
 * exist remotely: a local-only document's persisted state is its only copy,
 * and discarding it would be deletion, which is the delete flow's job.
 *
 * The identity-write chain serializes the teardown behind any in-flight
 * persist so a mid-persist pass cannot resurrect the rows the teardown just
 * removed. The durable history is dropped deliberately: preserved under the
 * same (appKind, localId), a stale checkpoint would restore the discarded
 * ops into the re-pulled document and re-enqueue them as an uncovered local
 * delta — recreating the stuck queue this action exists to break.
 */
export function discardDocumentStoreLocalState(
  state: DocumentStoreState,
): Promise<boolean> {
  return chainIdentityWrite(state, async () => {
    const runtime = state.runtime;
    if (runtime.infra.dbStatus !== "ready") {
      return false;
    }

    const execSql = runtime.infra.execSql;
    const record = await state.persistence.loadDocument(execSql, state.localId);
    if (!record?.documentId) {
      return false;
    }

    await deletePersistedDocument({
      documentProjectors: runtime.infra.documentProjectors,
      execSql,
      localId: state.localId,
      persistence: state.persistence,
    });
    await clearDocumentSyncFailure(execSql, {
      appKind: DOCUMENTS_APP_KIND,
      localId: state.localId,
    });
    markDocumentStoreRemoved(state);
    runtime.util.log(
      `Documents: discarded local state for document ${state.localId}; priming restores the server copy`,
    );
    return true;
  });
}
