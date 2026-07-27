import { documentProjectionTables, documentTables } from "./schema";
import { type ExecSql, ensureSqlTables } from "./sqlSchema";

export function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  return ensureSqlTables(execSql, documentTables);
}

export function ensureDocumentProjectionTables(
  execSql: ExecSql,
): Promise<void> {
  return ensureSqlTables(execSql, documentProjectionTables);
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
