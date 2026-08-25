import { createPendingUpdateFields } from "../../data/documents/documentSync";
import type {
  DocumentsPersistence,
  PendingUpdateRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function listPendingDocumentUpdates(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<PendingUpdateRecord[]> {
  return input.persistence.listPendingUpdates(input.execSql, input.localId);
}

export async function enqueuePendingDocumentUpdate(input: {
  execSql: ExecSql;
  expectedDocumentId?: string | null;
  localId: string;
  persistence: DocumentsPersistence;
  sourceVersionVector?: string | null;
  update: Uint8Array;
}): Promise<boolean> {
  const pendingUpdateFields = createPendingUpdateFields(
    input.update,
    input.sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return input.expectedDocumentId === undefined
      ? true
      : input.persistence.documentIdentityMatches(
          input.execSql,
          input.localId,
          input.expectedDocumentId,
        );
  }

  return input.persistence.enqueuePendingUpdate(
    input.execSql,
    {
      localId: input.localId,
      ...pendingUpdateFields,
    },
    input.expectedDocumentId === undefined
      ? undefined
      : { expectedDocumentId: input.expectedDocumentId },
  );
}
