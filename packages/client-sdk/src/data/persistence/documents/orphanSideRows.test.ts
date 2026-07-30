import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ensureDocumentProjectionTables,
  ensureDocumentTables,
} from "../../sqlite/documentPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import { deleteOrphanedDocumentSideRows } from "./internal/orphanSideRows";

const OLD = "2026-07-01T00:00:00.000Z";
const FRESH = "2026-07-30T00:00:00.000Z";
const CUTOFF = "2026-07-29T00:00:00.000Z";

test("maintenance sweeps aged orphan rows but preserves fresh and live rows", async () => {
  const { close, execSql } = await createTestExecSql("orphan-side-row-sweep");
  try {
    await ensureDocumentTables(execSql);
    await ensureDocumentProjectionTables(execSql);
    await execSql(
      `INSERT INTO documents (app_kind, local_id, updated_at)
       VALUES ('documents', 'live', ?)`,
      [OLD],
    );
    await execSql(
      `INSERT INTO document_history_checkpoints (
        app_kind, local_id, snapshot, end_version_vector, revision, updated_at
      ) VALUES
        ('documents', 'live', 'snapshot', 'end', 'live-revision', ?),
        ('documents', 'orphan', 'snapshot', 'end', 'orphan-revision', ?),
        ('documents', 'fresh', 'snapshot', 'end', 'fresh-revision', ?),
        ('container-metadata', 'metadata', 'snapshot', 'end', 'metadata-revision', ?)`,
      [OLD, OLD, FRESH, OLD],
    );
    await execSql(
      `INSERT INTO document_history_updates (
        id, app_kind, local_id, update_data, origin, created_at
      ) VALUES
        ('live-history', 'documents', 'live', 'update', 'local', ?),
        ('orphan-history', 'documents', 'orphan', 'update', 'local', ?),
        ('fresh-history', 'documents', 'fresh', 'update', 'local', ?),
        ('metadata-history', 'container-metadata', 'metadata', 'update', 'local', ?)`,
      [OLD, OLD, FRESH, OLD],
    );
    await execSql(
      `INSERT INTO document_pending_updates (
        id, app_kind, local_id, update_data,
        partial_start_version_vector, partial_end_version_vector, created_at
      ) VALUES
        ('live-update', 'documents', 'live', 'update', 'start', 'end', ?),
        ('orphan-update', 'documents', 'orphan', 'update', 'start', 'end', ?),
        ('fresh-update', 'documents', 'fresh', 'update', 'start', 'end', ?),
        ('metadata-update', 'container-metadata', 'metadata', 'update', 'start', 'end', ?)`,
      [OLD, OLD, FRESH, OLD],
    );
    await execSql(
      `INSERT INTO document_sync_failures (
        app_kind, local_id, status, message, attempted_at
      ) VALUES
        ('documents', 'live', 409, 'live', ?),
        ('documents', 'orphan', 409, 'orphan', ?),
        ('documents', 'fresh', 409, 'fresh', ?),
        ('container-metadata', 'metadata', 409, 'metadata', ?)`,
      [OLD, OLD, FRESH, OLD],
    );
    await execSql(
      `INSERT INTO document_pending_attachments (
        local_id, slot_id, name, storage_key, byte_length, created_at
      ) VALUES
        ('live', 'live-slot', 'live.txt', 'live-pending', 1, ?),
        ('orphan', 'orphan-slot', 'orphan.txt', 'orphan-pending', 1, ?),
        ('fresh', 'fresh-slot', 'fresh.txt', 'fresh-pending', 1, ?)`,
      [OLD, OLD, FRESH],
    );
    await execSql(
      `INSERT INTO document_attachment_blob_projection (
        local_id, slot_id, storage_key, byte_length, updated_at
      ) VALUES
        ('live', 'live-slot', 'live-local', 1, ?),
        ('orphan', 'orphan-slot', 'orphan-local', 1, ?),
        ('fresh', 'fresh-slot', 'fresh-local', 1, ?)`,
      [OLD, OLD, FRESH],
    );

    await sqlDocumentsPersistence.ensureSchema(execSql);
    await deleteOrphanedDocumentSideRows(execSql, CUTOFF);

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
        { appKind: "documents", localId: "fresh" },
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
      ).toEqual([{ localId: "fresh" }, { localId: "live" }]);
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
  } finally {
    close();
  }
});
