import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import type { DocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type {
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

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
