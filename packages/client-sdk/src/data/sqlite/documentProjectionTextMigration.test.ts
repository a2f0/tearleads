import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { ensureDocumentProjectionTables } from "./documentPersistence";

async function listColumnNames(
  execSql: Parameters<typeof ensureDocumentProjectionTables>[0],
  tableName: string,
): Promise<string[]> {
  const rows = await execSql(`PRAGMA table_info("${tableName}")`);
  return rows.flatMap((row) => {
    const name = Reflect.get(row, "name");
    return typeof name === "string" ? [name] : [];
  });
}

test("legacy document_projection text column migrates into document_projection_text", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-projection-text-migration",
  );
  try {
    // Pre-split shape: text stored inline in the projection row.
    await execSql(`CREATE TABLE "document_projection" (
      "local_id" TEXT PRIMARY KEY,
      "document_id" TEXT,
      "container_id" TEXT,
      "organization_id" TEXT,
      "document_kind" TEXT NOT NULL DEFAULT 'note',
      "text" TEXT NOT NULL,
      "title" TEXT NOT NULL DEFAULT 'Untitled note',
      "updated_at" TEXT NOT NULL
    )`);
    await execSql(
      `INSERT INTO document_projection
        (local_id, container_id, document_kind, text, title, updated_at)
       VALUES ('doc-1', 'root', 'note', 'legacy text body', 'Legacy', '2026-01-01T00:00:00.000Z')`,
    );

    await ensureDocumentProjectionTables(execSql);

    expect(await listColumnNames(execSql, "document_projection")).not.toContain(
      "text",
    );
    expect(
      await execSql(
        "SELECT local_id, text FROM document_projection_text ORDER BY local_id",
      ),
    ).toEqual([{ local_id: "doc-1", text: "legacy text body" }]);
    // Idempotent on re-run.
    await ensureDocumentProjectionTables(execSql);
    expect(
      await execSql("SELECT count(*) AS n FROM document_projection_text"),
    ).toEqual([{ n: 1 }]);
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
