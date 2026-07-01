import { documentTables } from "./schema";
import { type ExecSql, ensureSqlColumns, ensureSqlTables } from "./sqlSchema";

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
  await ensureSqlColumns(execSql, "documents", [
    {
      name: "effective_access_level",
      definition: "\"effective_access_level\" TEXT NOT NULL DEFAULT 'read'",
    },
    {
      name: "pending_base_version",
      definition: '"pending_base_version" TEXT',
    },
  ]);
}

/**
 * Additive column migrations for `document_pending_attachments`, applied wherever
 * `documentProjectionTables` is ensured (the table lives in that set, not
 * `documentTables`). Idempotent: `ensureSqlColumns` only adds missing columns.
 */
export async function ensureDocumentPendingAttachmentColumns(
  execSql: ExecSql,
): Promise<void> {
  await ensureSqlColumns(execSql, "document_pending_attachments", [
    { name: "upload_blob_id", definition: '"upload_blob_id" TEXT' },
    { name: "upload_content_key", definition: '"upload_content_key" TEXT' },
    { name: "upload_iv", definition: '"upload_iv" TEXT' },
    {
      name: "upload_content_key_epoch",
      definition: '"upload_content_key_epoch" INTEGER',
    },
    { name: "upload_part_size", definition: '"upload_part_size" INTEGER' },
    { name: "upload_stage_id", definition: '"upload_stage_id" TEXT' },
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
