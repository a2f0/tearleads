import { documentProjectionTables, documentTables } from "./schema";
import { type ExecSql, ensureSqlColumns, ensureSqlTables } from "./sqlSchema";

export function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  return ensureSqlTables(execSql, documentTables);
}

export async function ensureDocumentProjectionTables(
  execSql: ExecSql,
): Promise<void> {
  await ensureSqlTables(execSql, documentProjectionTables);
  await ensureSqlColumns(execSql, "document_attachment_blob_projection", [
    { name: "detached_at", definition: '"detached_at" TEXT' },
  ]);
}

export {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  enqueueDocumentPendingUpdateWithHistory,
  listDocumentPendingUpdates,
  MAX_PENDING_UPDATE_REKEYS,
  rekeyDocumentPendingUpdate,
  resetDocumentPendingUpdateRekeyBudget,
} from "./documentPendingUpdatePersistence";
export type {
  DocumentRecord,
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
} from "./documentPersistenceTypes";
export {
  deleteDocumentRecord,
  findLocalIdByDocumentId,
  loadDocumentRecord,
  mapSelectedDocumentRecord,
} from "./documentRecordPersistence";
export {
  clearDocumentSyncFailure,
  hasRecordedTerminalSyncFailures,
  recordDocumentSyncFailure,
} from "./documentSyncFailurePersistence";
