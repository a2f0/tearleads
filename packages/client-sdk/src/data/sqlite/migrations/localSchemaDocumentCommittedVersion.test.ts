import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../schema/documentRecordSchema";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

const [documents] = documentTables;
if (!documents) throw new Error("Documents table schema is missing");

// The version-12 shape: the current table without its committed version.
const VERSION_12_DOCUMENTS = documents.createSql.replace(
  '  "committed_version" TEXT,\n',
  "",
);

const VERSION_12_STEPS = localSchemaMigrations.filter(
  (migration) => migration.version <= 12,
);

test("step 13 reads a version-12 database's records as having seen nothing committed", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-document-committed-version",
  );
  try {
    expect(VERSION_12_DOCUMENTS).not.toContain('"committed_version"');
    await migrateLocalSchema(execSql, { migrations: VERSION_12_STEPS });
    await execSql(VERSION_12_DOCUMENTS);
    await execSql(
      `INSERT INTO documents (app_kind, local_id, document_id, updated_at)
       VALUES ('documents', 'note', 'remote-note', '2026-11-25T00:00:00.000Z')`,
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(
      await execSql("SELECT document_id, committed_version FROM documents"),
    ).toEqual([{ committed_version: null, document_id: "remote-note" }]);
    // The migrated table is the shape the current definition checks.
    await ensureSqlTables(execSql, documentTables);
  } finally {
    close();
  }
});

// A table that somehow missed the step is refused, not read with no column.
test("the current definition refuses a documents table without the column", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-document-committed-version-missing",
  );
  try {
    await migrateLocalSchema(execSql);
    await execSql(VERSION_12_DOCUMENTS);

    await expect(ensureSqlTables(execSql, documentTables)).rejects.toThrow(
      "obsolete",
    );
  } finally {
    close();
  }
});

test("step 13 skips a version-12 database without the documents table", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-document-committed-version-absent",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_12_STEPS });
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    expect(
      await execSql("SELECT name FROM sqlite_master WHERE name = 'documents'"),
    ).toEqual([]);
  } finally {
    close();
  }
});
