import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ensureDocumentProjectionTables,
  ensureDocumentTables,
} from "../../sqlite/documentPersistence";
import { resetConnectionSchemaMemo } from "../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "./documentsPersistence";

const NOW = "2026-07-30T00:00:00.000Z";

test("schema initialization sweeps orphan document side rows", async () => {
  const { close, execSql } = await createTestExecSql("orphan-side-row-sweep");
  try {
    await ensureDocumentTables(execSql);
    await ensureDocumentProjectionTables(execSql);
    await execSql(
      `INSERT INTO documents (app_kind, local_id, updated_at)
       VALUES ('documents', 'live', ?)`,
      [NOW],
    );
    await execSql(
      `INSERT INTO document_history_checkpoints (
        app_kind, local_id, snapshot, end_version_vector, revision, updated_at
      ) VALUES
        ('documents', 'live', 'snapshot', 'end', 'live-revision', ?),
        ('documents', 'orphan', 'snapshot', 'end', 'orphan-revision', ?),
        ('container-metadata', 'metadata', 'snapshot', 'end', 'metadata-revision', ?)`,
      [NOW, NOW, NOW],
    );
    await execSql(
      `INSERT INTO document_history_updates (
        id, app_kind, local_id, update_data, origin, created_at
      ) VALUES
        ('live-history', 'documents', 'live', 'update', 'local', ?),
        ('orphan-history', 'documents', 'orphan', 'update', 'local', ?),
        ('metadata-history', 'container-metadata', 'metadata', 'update', 'local', ?)`,
      [NOW, NOW, NOW],
    );
    await execSql(
      `INSERT INTO document_pending_updates (
        id, app_kind, local_id, update_data,
        partial_start_version_vector, partial_end_version_vector, created_at
      ) VALUES
        ('live-update', 'documents', 'live', 'update', 'start', 'end', ?),
        ('orphan-update', 'documents', 'orphan', 'update', 'start', 'end', ?),
        ('metadata-update', 'container-metadata', 'metadata', 'update', 'start', 'end', ?)`,
      [NOW, NOW, NOW],
    );
    await execSql(
      `INSERT INTO document_sync_failures (
        app_kind, local_id, status, message, attempted_at
      ) VALUES
        ('documents', 'live', 409, 'live', ?),
        ('documents', 'orphan', 409, 'orphan', ?),
        ('container-metadata', 'metadata', 409, 'metadata', ?)`,
      [NOW, NOW, NOW],
    );
    await execSql(
      `INSERT INTO document_pending_attachments (
        local_id, slot_id, name, storage_key, byte_length, created_at
      ) VALUES
        ('live', 'live-slot', 'live.txt', 'live-pending', 1, ?),
        ('orphan', 'orphan-slot', 'orphan.txt', 'orphan-pending', 1, ?)`,
      [NOW, NOW],
    );
    await execSql(
      `INSERT INTO document_attachment_blob_projection (
        local_id, slot_id, storage_key, byte_length, updated_at
      ) VALUES
        ('live', 'live-slot', 'live-local', 1, ?),
        ('orphan', 'orphan-slot', 'orphan-local', 1, ?)`,
      [NOW, NOW],
    );

    await sqlDocumentsPersistence.ensureSchema(execSql);

    for (const table of [
      "document_history_checkpoints",
      "document_history_updates",
      "document_pending_updates",
      "document_sync_failures",
    ]) {
      expect(
        await execSql(
          `SELECT app_kind AS appKind, local_id AS localId FROM ${table}
           ORDER BY app_kind, local_id`,
        ),
      ).toEqual([
        { appKind: "container-metadata", localId: "metadata" },
        { appKind: "documents", localId: "live" },
      ]);
    }
    for (const table of [
      "document_pending_attachments",
      "document_attachment_blob_projection",
    ]) {
      expect(
        await execSql(
          `SELECT local_id AS localId FROM ${table} ORDER BY local_id`,
        ),
      ).toEqual([{ localId: "live" }]);
    }
    expect(
      await execSql(
        `SELECT storage_key AS storageKey
         FROM document_orphan_blob_reclaims ORDER BY storage_key`,
      ),
    ).toEqual([
      { storageKey: "orphan-local" },
      { storageKey: "orphan-pending" },
    ]);

    await execSql(
      `INSERT INTO document_pending_updates (
        id, app_kind, local_id, update_data,
        partial_start_version_vector, partial_end_version_vector, created_at
      ) VALUES ('late', 'documents', 'late-orphan', 'update', 'start', 'end', ?)`,
      [NOW],
    );
    await sqlDocumentsPersistence.ensureSchema(execSql);
    expect(
      await execSql(
        "SELECT id FROM document_pending_updates WHERE id = 'late'",
      ),
    ).toEqual([{ id: "late" }]);

    resetConnectionSchemaMemo(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    expect(
      await execSql(
        "SELECT id FROM document_pending_updates WHERE id = 'late'",
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});
