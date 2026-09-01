import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { ensureDocumentProjectionTables } from "./documentPersistence";

test("document_projection gets container, orphan, and document indexes", async () => {
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
    expect(names).toContain("document_projection_orphan_organization_idx");
    expect(names).toContain("document_projection_document_idx");
  } finally {
    close();
  }
});
