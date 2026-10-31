import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import type { DocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type {
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type PrepareDocumentMutationInput,
  prepareDocumentMutation,
} from "./documentMutationPreparation";

/** Refuse a queued update after another subsystem deleted its canonical row. */
export async function refuseDeletedDocumentPersist(input: {
  currentRecord: StoredDocumentRecord | null;
  documentProjectors: DocumentProjectorRegistry;
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<boolean> {
  const { currentRecord } = input;
  if (!currentRecord) return false;
  return input.persistence.deleteDocumentSideRowsIfAbsent(
    input.execSql,
    input.localId,
    currentRecord.documentId,
    async (transactionExecSql) => {
      await input.documentProjectors.deleteStoredDocumentClientProjection({
        documentKind: currentRecord.documentKind ?? DEFAULT_DOCUMENT_KIND,
        execSql: transactionExecSql,
        localId: input.localId,
      });
    },
  );
}

/**
 * The preparation read doubles as the first look for a deleted row: only when
 * it finds none does the guard open its own transaction, which reads again
 * under the write lock before it refuses. A row it then finds (or an alias it
 * must keep) is prepared afresh, as before the guard moved.
 */
export async function prepareDocumentMutationUnlessDeleted(input: {
  documentProjectors: DocumentProjectorRegistry;
  guard: boolean;
  lockedExecSql: ExecSql;
  patch: Partial<StoredDocumentRecord>;
  persistInput: PrepareDocumentMutationInput & { localId: string };
}) {
  const { lockedExecSql, persistInput } = input;
  const prepare = () =>
    prepareDocumentMutation(persistInput, lockedExecSql, input.patch);
  const mutation = await prepare();
  if (
    !input.guard ||
    persistInput.currentRecord === null ||
    mutation.durableCurrentRecord !== null
  )
    return mutation;
  const refused = await refuseDeletedDocumentPersist({
    currentRecord: persistInput.currentRecord,
    documentProjectors: input.documentProjectors,
    execSql: lockedExecSql,
    localId: persistInput.localId,
    persistence: persistInput.persistence,
  });
  return refused ? null : prepare();
}
