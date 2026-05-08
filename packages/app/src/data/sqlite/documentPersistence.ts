import { documentTables } from "./schema";
import { type ExecSql, ensureSqlTables } from "./sqlSchema";

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
}

export {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  listDocumentPendingUpdates,
} from "./documentPendingUpdatePersistence";
export type {
  DocumentRecord,
  DocumentScope,
  PendingUpdateFields,
  PendingUpdateRecord,
  SelectedDocumentRecordRow,
} from "./documentPersistenceTypes";
export {
  deleteDocumentRecord,
  findLocalIdByDocumentId,
  loadDocumentRecord,
  mapSelectedDocumentRecord,
  saveDocumentRecord,
} from "./documentRecordPersistence";
