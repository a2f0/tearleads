import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentProjectionTables, documentTables } from "./schema";
import { ensureSqlTables } from "./sqlTableSchema";

const documentsTable = documentTables[0];
if (!documentsTable) throw new Error("Documents table schema is missing");

test.each([
  ['"pull_continuation" TEXT', "pull_continuation"],
  ['"recovery_generation" INTEGER NOT NULL DEFAULT 0', "recovery_generation"],
  ['"recovery_document_id" TEXT', "recovery_document_id"],
])(
  "obsolete document schema requires reset instead of adding %s",
  async (definition, column) => {
    const { close, execSql } = await createTestExecSql(
      "document-schema-flag-day",
    );
    try {
      const obsoleteSql = documentsTable.createSql.replace(
        `  ${definition},\n`,
        "",
      );
      expect(obsoleteSql).not.toContain(definition);
      await execSql(obsoleteSql);
      await expect(ensureSqlTables(execSql, [documentsTable])).rejects.toThrow(
        "reset the local database before continuing",
      );
      const columns = await execSql("PRAGMA table_info(documents)");
      expect(columns.some(({ name }) => name === column)).toBe(false);
    } finally {
      close();
    }
  },
);

test("a fresh document schema includes current durable progress and recovery fields", async () => {
  const { close, execSql } = await createTestExecSql("document-schema-current");
  try {
    await ensureSqlTables(execSql, [documentsTable]);
    await execSql(`
      INSERT INTO documents (
        app_kind, local_id, access_epoch, effective_access_level,
        snapshot_end_version, updated_at
      ) VALUES ('documents', 'local-1', 1, 'read', '', '2026-09-04')
    `);
    expect(
      await execSql(
        "SELECT pull_continuation, recovery_generation, recovery_document_id FROM documents WHERE local_id = 'local-1'",
      ),
    ).toEqual([
      {
        pull_continuation: null,
        recovery_generation: 0,
        recovery_document_id: null,
      },
    ]);
  } finally {
    close();
  }
});

test.each([
  "document_pending_attachments",
  "document_attachment_blob_projection",
])(
  "obsolete %s schema without content_sha256 requires reset",
  async (tableName) => {
    const table = documentProjectionTables.find(
      (candidate) => candidate.name === tableName,
    );
    if (!table) throw new Error(`${tableName} schema is missing`);
    const { close, execSql } = await createTestExecSql(
      "attachment-schema-flag-day",
    );
    try {
      const obsoleteSql = table.createSql.replace(
        '  "content_sha256" TEXT NOT NULL,\n',
        "",
      );
      expect(obsoleteSql).not.toContain("content_sha256");
      await execSql(obsoleteSql);
      await expect(ensureSqlTables(execSql, [table])).rejects.toThrow(
        "reset the local database before continuing",
      );
    } finally {
      close();
    }
  },
);
