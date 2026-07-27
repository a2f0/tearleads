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
 * restart must happen OUTSIDE the identity-chained task — initialization
 * chains identity writes of its own, so starting it there would deadlock.
 */
export async function discardDocumentStoreLocalState(
  state: DocumentStoreState,
  expectedDocumentId: string,
): Promise<boolean> {
  const runtime = state.runtime;
  if (runtime.infra.dbStatus !== "ready") {
    return false;
  }

  // Cheap eligibility probe before disturbing the live store: an obviously
  // ineligible document (local-only, unlinked, or one whose identity is not
  // the one the caller asked to discard) returns without stopping writes.
  // The workflow re-checks under its serialized mutation, so a status change
  // between here and there is still refused safely.
  const execSql = runtime.infra.execSql;
  const record = await state.persistence.loadDocument(execSql, state.localId);
  if (
    !record?.documentId ||
    record.documentId !== expectedDocumentId ||
    !record.containerId
  ) {
    return false;
  }

  // Stop local writes before draining: dropping the live doc rejects new
  // mutations at queue time, and the generation bump invalidates queued
  // write tasks that have not started (and in-flight attachment passes and
  // initializations, which re-check the generation inside their writes'
  // serialized mutations).
  state.doc = null;
  state.localWriteGeneration += 1;
  // Drain OUTSIDE the identity chain. Write-chain tasks can themselves enter
  // the identity chain (the stale-heal recovery installs its rebuilt
  // document that way), so awaiting the write chain while holding an
  // identity-chain slot would deadlock: the drained task would queue behind
  // this one and each would wait on the other forever. Out here the drain is
  // a plain await; whatever the drained tasks chain onto the identity chain
  // runs before the teardown task below and is superseded by it.
  await state.writeChain.catch(() => undefined);

  return chainIdentityWrite(state, async () => {
    let shell: Awaited<ReturnType<typeof discardPersistedDocumentToShell>>;
    try {
      shell = await discardPersistedDocumentToShell({
        documentProjectors: runtime.infra.documentProjectors,
        execSql,
        expectedDocumentId,
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

    // Reclaim the bytes whose rows the conversion dropped (staged uploads
    // and detached local-attachment caches). The rows were their only
    // durable pointers, so a failed delete is retried a few times and then
    // LOGGED with its key rather than silently swallowed — the rows are
    // already gone, so the discard itself still succeeded, but the orphaned
    // encrypted bytes should be visible to diagnostics instead of invisible.
    const orphanedStorageKeys: string[] = [];
    for (const storageKey of shell.reclaimableBlobStorageKeys) {
      if (!(await deleteBlobBytesWithRetry(state, storageKey))) {
        orphanedStorageKeys.push(storageKey);
      }
    }
    if (orphanedStorageKeys.length > 0) {
      runtime.util.log(
        `Documents: discard for document ${state.localId} could not reclaim ${orphanedStorageKeys.length} blob(s): ${orphanedStorageKeys.join(", ")}`,
      );
    }
    resetDocumentStore(state);
    runtime.util.log(
      `Documents: discarded local edits for document ${state.localId}; re-pulling the server copy`,
    );
    return true;
  });
}

const BLOB_RECLAIM_ATTEMPTS = 3;

async function deleteBlobBytesWithRetry(
  state: DocumentStoreState,
  storageKey: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < BLOB_RECLAIM_ATTEMPTS; attempt += 1) {
    try {
      await state.runtime.infra.blobStore.deleteBytes(storageKey);
      return true;
    } catch {
      // Retry: byte-store deletes fail transiently (e.g. an OPFS handle
      // briefly held elsewhere), and the pointer rows are already gone.
    }
  }
  return false;
}
