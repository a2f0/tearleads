import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import {
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type {
  DiscardDocumentToShellResult,
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { ensureDocumentClientProjectionTables } from "./persistence";

export async function deletePersistedDocument(input: {
  canStartDurableMutation?: (() => boolean) | undefined;
  documentProjectors: DocumentProjectorRegistryInput;
  execSql: ExecSql;
  expectedRecord?: StoredDocumentRecord | undefined;
  localId: string;
  /**
   * Runs INSIDE the serialized mutation, after the deletes commit: callers
   * invalidate their in-memory store generation here so any failure handler
   * queued behind this mutation observes the invalidation and cannot
   * resurrect a row the deletion just removed.
   */
  onDeletedInMutation?: (() => void) | undefined;
  persistence: DocumentsPersistence;
}): Promise<boolean> {
  const documentProjectors = resolveDocumentProjectorRegistry(
    input.documentProjectors,
  );
  await input.persistence.ensureSchema(input.execSql);
  await ensureDocumentClientProjectionTables({
    documentProjectors,
    execSql: input.execSql,
  });
  let deleted = false;
  await runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    // The guard runs INSIDE the claimed mutation: the pre-claim answer can go
    // stale while the deletion waits behind another mutation (a store reset,
    // a replacement generation's persist), and deleting on the stale answer
    // would wipe rows the newer generation just wrote.
    if (input.canStartDurableMutation && !input.canStartDurableMutation()) {
      return;
    }
    if (input.expectedRecord) {
      const identityMatched = await input.persistence.deleteDocumentIfMatches(
        lockedExecSql,
        input.expectedRecord,
        (transactionExecSql) =>
          documentProjectors.deleteStoredDocumentClientProjection({
            documentKind:
              input.expectedRecord?.documentKind ?? DEFAULT_DOCUMENT_KIND,
            execSql: transactionExecSql,
            localId: input.localId,
          }),
      );
      if (!identityMatched) return;
    } else {
      const existing = await input.persistence.loadDocument(
        lockedExecSql,
        input.localId,
      );
      await input.persistence.deleteDocument(lockedExecSql, input.localId);
      await documentProjectors.deleteStoredDocumentClientProjection({
        documentKind: existing?.documentKind ?? DEFAULT_DOCUMENT_KIND,
        execSql: lockedExecSql,
        localId: input.localId,
      });
    }
    input.onDeletedInMutation?.();
    deleted = true;
  });
  return deleted;
}

export type DiscardedDocumentShellResult = DiscardDocumentToShellResult;

/**
 * Convert a stuck document's local state to the freshly-discovered-share
 * shell. The persistence implementation owns the whole sequence — the
 * eligibility checks (local-only, unlinked, or move-pending documents are
 * refused), the row teardown, the document-kind client-projection clear, and
 * the shell upsert — and commits it as ONE transaction, so an interruption
 * leaves either the fully old or the fully shelled document (never, e.g., a
 * discarded contact whose projected fields stay visible). Implementations
 * without the full document schema do not offer the operation and refuse.
 *
 * Returns the reclaimable storage keys on success — the deleted rows were
 * the only durable pointers to those bytes, so the caller reclaims them.
 */
export async function discardPersistedDocumentToShell(input: {
  documentProjectors: DocumentProjectorRegistryInput;
  execSql: ExecSql;
  expectedDocumentId: string;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<DiscardedDocumentShellResult> {
  await input.persistence.ensureSchema(input.execSql);
  if (!input.persistence.discardDocumentToShell) {
    return { discarded: false };
  }
  return input.persistence.discardDocumentToShell(
    input.execSql,
    input.localId,
    input.expectedDocumentId,
    input.documentProjectors,
  );
}
