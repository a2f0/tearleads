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
  if (!input.currentRecord) return false;
  if (await input.persistence.hasDocument(input.execSql, input.localId)) {
    return false;
  }

  await input.persistence.deleteDocument(input.execSql, input.localId);
  await input.documentProjectors.deleteStoredDocumentClientProjection({
    documentKind: input.currentRecord.documentKind ?? DEFAULT_DOCUMENT_KIND,
    execSql: input.execSql,
    localId: input.localId,
  });
  return true;
}
