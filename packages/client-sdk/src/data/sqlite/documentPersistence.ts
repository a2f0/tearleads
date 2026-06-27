import { documentTables } from "./schema";
import { type ExecSql, ensureSqlColumns, ensureSqlTables } from "./sqlSchema";

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
  await ensureSqlColumns(execSql, "documents", [
    {
      name: "effective_access_level",
      definition: "\"effective_access_level\" TEXT NOT NULL DEFAULT 'admin'",
    },
  ]);
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
} from "./documentPersistenceTypes";
export {
  deleteDocumentRecord,
  findLocalIdByDocumentId,
  loadDocumentRecord,
  mapSelectedDocumentRecord,
  saveDocumentRecord,
} from "./documentRecordPersistence";
