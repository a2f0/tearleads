import { documentProjectionTables, documentTables } from "./schema";
import {
  type ExecSql,
  ensureSqlColumns,
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "./sqlSchema";

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

// One-time destructive move for databases created before the projected text
// was split into `document_projection_text`: copy the legacy column out, then
// drop it so list/window scans stop paging past content-sized rows. Runs under
// the shared mutation lock so the copy and the drop cannot interleave with
// other writers.
async function migrateLegacyProjectionTextColumn(
  execSql: ExecSql,
): Promise<void> {
  await runOncePerConnection(
    execSql,
    "migration:document-projection-text",
    () => runMigrateLegacyProjectionTextColumn(execSql),
  );
}

async function runMigrateLegacyProjectionTextColumn(
  execSql: ExecSql,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const columns = await lockedExecSql(
      'PRAGMA table_info("document_projection")',
    );
    const hasLegacyTextColumn = columns.some(
      (column) => Reflect.get(column, "name") === "text",
    );
    if (!hasLegacyTextColumn) {
      return;
    }

    await lockedExecSql(
      `INSERT OR REPLACE INTO document_projection_text (local_id, text)
       SELECT local_id, text FROM document_projection
       WHERE local_id IS NOT NULL`,
    );
    await lockedExecSql('ALTER TABLE "document_projection" DROP COLUMN "text"');
  });
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
  await migrateLegacyProjectionTextColumn(execSql);
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
