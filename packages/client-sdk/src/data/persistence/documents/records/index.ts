import { documentProjectionTables } from "../../../sqlite/schema/documentProjectionSchema";
import { documentTables } from "../../../sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../../sqlite/sqlSchema";

export function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  return ensureSqlTables(execSql, documentTables);
}

export function ensureDocumentProjectionTables(
  execSql: ExecSql,
): Promise<void> {
  return ensureSqlTables(execSql, documentProjectionTables);
}

export { recordCommittedSeedProgressInTransaction } from "./committedSeedProgress";
export { MAX_PENDING_UPDATE_REKEYS } from "./documentPendingUpdatePersistence";
export type {
  DocumentRecord,
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
  QueuedPendingUpdateRecord,
} from "./documentPersistenceTypes";
export type { QueuedUpdateReplacement } from "./documentQueuedUpdateReplacement";
export {
  documentRecordSelection,
  mapSelectedDocumentRecord,
} from "./documentRecordPersistence";
export { DocumentRecordRepository } from "./documentRecordRepository";
