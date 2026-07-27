import {
  clearDocumentSyncFailure,
  DOCUMENTS_APP_KIND,
  deletePersistedDocument,
} from "../../../workflows/documents";
import { chainIdentityWrite } from "./identityWriteChain";
import { type DocumentStoreState, resetDocumentStore } from "./state";

/**
 * User-initiated escape hatch for a document whose queued local writes can no
 * longer sync (e.g. an outgoing queue whose update ids conflict forever):
 * tear down the locally persisted document — record, pending updates,
 * projections, attachments, and durable history — then re-seed the
 * freshly-discovered-share shell (documentId kept, empty snapshot) so the
 * store re-hydrates the server copy. The shell matters twice over: priming's
 * candidate scan reads the documents rows themselves, so a fully deleted
 * record would never be restored after a restart, and re-initialization
 * needs the record to hydrate instead of eagerly creating a blank document.
 *
 * Restricted to documents that exist remotely (and carry a container to
 * anchor the shell): a local-only document's persisted state is its only
 * copy, and discarding it would be deletion, which is the delete flow's job.
 *
 * The durable history is dropped deliberately: preserved under the same
 * (appKind, localId), a stale checkpoint would restore the discarded ops
 * into the re-pulled document and re-enqueue them as an uncovered local
 * delta — recreating the stuck queue this action exists to break.
 *
 * The caller restarts initialization after a successful discard; the reset
 * store then hydrates from the shell. That restart must happen OUTSIDE this
 * identity-chained task — initialization chains identity writes of its own,
 * so starting it here would deadlock.
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
    if (!record?.documentId || !record.containerId) {
      return false;
    }

    // Stop local writes before touching rows: dropping the live doc rejects
    // new mutations at queue time, the generation bump invalidates queued
    // write tasks that have not started, and draining the write chain lets
    // already-started persists finish before the teardown deletes what they
    // wrote. Mutation tasks never join the identity-write chain, so awaiting
    // the write chain inside this identity-chained task cannot deadlock.
    state.doc = null;
    state.localWriteGeneration += 1;
    await state.writeChain.catch(() => undefined);

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
    // The discovered-share shell, saved under this store's own localId (the
    // discovery upsert would re-derive one from the documentId instead). An
    // empty snapshot with a null outgoing-delta marker is exactly the state
    // a fresh share hydrates from; the null key bundles force the re-pull to
    // fetch current ones. The title is kept so listings stay readable while
    // the content re-downloads.
    await state.persistence.saveDocument(execSql, {
      id: state.localId,
      accessEpoch: record.accessEpoch,
      accessStateHash: record.accessStateHash ?? null,
      containerId: record.containerId,
      contentKeyBundle: null,
      documentId: record.documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      effectiveAccessLevel: record.effectiveAccessLevel ?? null,
      lastCommitLsn: null,
      loroSnapshot: "",
      pendingBaseVersion: null,
      text: "",
      ...(record.documentKind === undefined
        ? {}
        : { documentKind: record.documentKind }),
      ...(record.title === undefined ? {} : { title: record.title }),
    });
    resetDocumentStore(state);
    runtime.util.log(
      `Documents: discarded local edits for document ${state.localId}; re-pulling the server copy`,
    );
    return true;
  });
}
