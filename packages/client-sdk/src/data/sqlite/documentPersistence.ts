import { documentProjectionTables, documentTables } from "./schema";
import { type ExecSql, ensureSqlColumns, ensureSqlTables } from "./sqlSchema";

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
  await ensureSqlColumns(execSql, "document_pending_updates", [
    {
      name: "rekey_count",
      definition: '"rekey_count" INTEGER NOT NULL DEFAULT 0',
    },
  ]);
  await ensureSqlColumns(execSql, "documents", [
    {
      name: "effective_access_level",
      definition: "\"effective_access_level\" TEXT NOT NULL DEFAULT 'read'",
    },
    {
      name: "pending_base_version",
      definition: '"pending_base_version" TEXT',
    },
    {
      name: "snapshot_end_version",
      definition: "\"snapshot_end_version\" TEXT NOT NULL DEFAULT ''",
    },
  ]);
}

export async function ensureDocumentProjectionTables(
  execSql: ExecSql,
): Promise<void> {
  await ensureSqlTables(execSql, documentProjectionTables);
  await ensureSqlColumns(execSql, "document_projection", [
    {
      name: "organization_id",
      definition: '"organization_id" TEXT',
    },
  ]);
}

export {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  listDocumentPendingUpdates,
  MAX_PENDING_UPDATE_REKEYS,
  rekeyDocumentPendingUpdate,
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
export {
  clearDocumentSyncFailure,
  hasRecordedTerminalSyncFailures,
  recordDocumentSyncFailure,
} from "./documentSyncFailurePersistence";
