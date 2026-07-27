import { discardPersistedDocumentToShell } from "../../../workflows/documents";
import { chainIdentityWrite } from "./identityWriteChain";
import { type DocumentStoreState, resetDocumentStore } from "./state";

/**
 * User-initiated escape hatch for a document whose queued local writes can no
 * longer sync (e.g. an outgoing queue whose update ids conflict forever):
 * convert the locally persisted document to the freshly-discovered-share
 * shell (documentId kept, empty snapshot, queue/history/failure rows
 * dropped) so the store re-hydrates the server copy. The shell matters twice
 * over: priming's candidate scan reads the documents rows themselves, so a
 * fully deleted record would never be restored after a restart, and
 * re-initialization needs the record to hydrate instead of eagerly creating
 * a blank document. discardPersistedDocumentToShell owns the row-level
 * sequence — including refusing local-only, unlinked, and move-pending
 * documents under its serialized mutation — and converts the record in
 * place, so no step leaves the document row absent.
 *
 * The caller restarts initialization after this settles (success or not);
 * the reset store then hydrates from whatever rows the sequence left. That
 * restart must happen OUTSIDE this identity-chained task — initialization
 * chains identity writes of its own, so starting it here would deadlock.
 */
export function discardDocumentStoreLocalState(
  state: DocumentStoreState,
): Promise<boolean> {
  return chainIdentityWrite(state, async () => {
    const runtime = state.runtime;
    if (runtime.infra.dbStatus !== "ready") {
      return false;
    }

    // Cheap eligibility probe before disturbing the live store: an obviously
    // ineligible document (local-only, unlinked) returns without stopping
    // writes. The workflow re-checks under its serialized mutation, so a
    // status change between here and there is still refused safely.
    const execSql = runtime.infra.execSql;
    const record = await state.persistence.loadDocument(execSql, state.localId);
    if (!record?.documentId || !record.containerId) {
      return false;
    }

    // Stop local writes before touching rows: dropping the live doc rejects
    // new mutations at queue time, the generation bump invalidates queued
    // write tasks that have not started (and in-flight attachment passes and
    // initializations, which re-check the generation before their own local
    // writes), and draining the write chain lets already-started persists
    // finish before the teardown deletes what they wrote. Mutation tasks
    // never join the identity-write chain, so awaiting the write chain
    // inside this identity-chained task cannot deadlock.
    state.doc = null;
    state.localWriteGeneration += 1;
    await state.writeChain.catch(() => undefined);

    let shell: Awaited<ReturnType<typeof discardPersistedDocumentToShell>>;
    try {
      shell = await discardPersistedDocumentToShell({
        execSql,
        localId: state.localId,
        persistence: state.persistence,
      });
    } catch {
      // The conversion is in-place, so an interrupted sequence still leaves a
      // loadable record (old or shell). Reset so re-initialization reloads
      // whatever survived instead of running on the dropped live doc.
      resetDocumentStore(state);
      runtime.util.log(
        `Documents: discard failed for document ${state.localId}; store reset to reload persisted state`,
      );
      return false;
    }
    if (!shell.discarded) {
      // Refused under the lock (a move intent, or an identity change since
      // the probe): rows are untouched; reset so the store reloads them.
      resetDocumentStore(state);
      return false;
    }

    // Reclaim the staged upload bytes whose rows the conversion dropped.
    // Best-effort per key: a missing blob must not fail the discard.
    for (const storageKey of shell.stagedAttachmentStorageKeys) {
      try {
        await runtime.infra.blobStore.deleteBytes(storageKey);
      } catch {
        // The bytes stay orphaned at worst; the discard still succeeded.
      }
    }
    resetDocumentStore(state);
    runtime.util.log(
      `Documents: discarded local edits for document ${state.localId}; re-pulling the server copy`,
    );
    return true;
  });
}
