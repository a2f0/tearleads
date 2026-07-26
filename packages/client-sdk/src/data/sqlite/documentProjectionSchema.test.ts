import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { ensureDocumentProjectionTables } from "./documentPersistence";

test("document_attachment_blob_projection gains detached_at on an older database", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-attachment-blob-projection-detached-at",
  );
  try {
    // The pre-detach-marker table shape, as an existing install still has it.
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

    await ensureDocumentProjectionTables(execSql);

    const rows = await execSql(
      `PRAGMA table_info("document_attachment_blob_projection")`,
    );
    const names = rows.map((row) => Reflect.get(row, "name"));
    expect(names).toContain("detached_at");
  } finally {
    close();
  }
});

test("document_projection gets container and document indexes", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-projection-indexes",
  );
  try {
    await ensureDocumentProjectionTables(execSql);
    const rows = await execSql(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND tbl_name = 'document_projection'`,
    );
    const names = rows.map((row) => Reflect.get(row, "name"));
    expect(names).toContain("document_projection_container_idx");
    expect(names).toContain("document_projection_document_idx");
  } finally {
    close();
  }
});
