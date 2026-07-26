import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  clientSqlTables,
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

const STALE = "2026-05-01T00:00:00.000Z";

test("clearRemoteSyncState migrates detached_at on an older database", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-detached-migration-test",
  );

  try {
    // The pre-detach-marker table shape. CREATE TABLE IF NOT EXISTS leaves it
    // alone, so the reset itself has to add the column before it reads one.
    await execSql(
      `CREATE TABLE "document_attachment_blob_projection" (
         "local_id" TEXT NOT NULL,
         "slot_id" TEXT NOT NULL,
         "blob_id" TEXT,
         "storage_key" TEXT NOT NULL,
         "mime_type" TEXT,
         "byte_length" INTEGER NOT NULL,
         "updated_at" TEXT NOT NULL,
         PRIMARY KEY ("local_id", "slot_id")
       )`,
    );
    await ensureSqlTables(execSql, clientSqlTables);

    await expect(clearRemoteSyncState(execSql)).resolves.toBeDefined();
  } finally {
    close();
  }
});

test("clearRemoteSyncState keeps detached markers out of the requeue", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-detached-requeue-test",
  );

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.insert(documentAttachmentBlobProjection).values([
      {
        localId: "doc-1",
        slotId: "slot-live",
        blobId: "blob-live",
        storageKey: "local/live",
        mimeType: "image/png",
        byteLength: 12,
        updatedAt: STALE,
        detachedAt: null,
      },
      {
        localId: "doc-1",
        slotId: "slot-unlinked",
        blobId: "blob-unlinked",
        storageKey: "local/unlinked",
        mimeType: "image/png",
        byteLength: 12,
        updatedAt: STALE,
        detachedAt: STALE,
      },
    ]);

    await clearRemoteSyncState(execSql);

    const pendingRows = await db
      .select({ slotId: documentPendingAttachments.slotId })
      .from(documentPendingAttachments);
    expect(pendingRows.map((row) => row.slotId)).toEqual(["slot-live"]);

    // The marker outlives the reset because it still owns the unlinked slot's
    // local bytes; the document lane's detach cleanup deletes both together.
    const projectionRows = await db
      .select({ slotId: documentAttachmentBlobProjection.slotId })
      .from(documentAttachmentBlobProjection);
    expect(projectionRows.map((row) => row.slotId)).toEqual(["slot-unlinked"]);
  } finally {
    close();
  }
});
