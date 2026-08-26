import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { documentTables } from "./schema";
import { ensureSqlTables } from "./sqlTableSchema";

test("document schema adds durable pull progress and recovery fencing", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-upgrade",
  );
  const documentsTable = documentTables[0];
  if (!documentsTable) throw new Error("Documents table schema is missing");
  const legacyCreateSql = documentsTable.createSql
    .replace('  "pull_continuation" TEXT,\n', "")
    .replace('  "recovery_generation" INTEGER NOT NULL DEFAULT 0,\n', "");
  expect(legacyCreateSql).not.toContain('"recovery_generation"');

  try {
    await execSql(legacyCreateSql);
    await execSql(`
      INSERT INTO documents (
        app_kind, local_id, access_epoch, effective_access_level,
        snapshot_end_version, updated_at
      ) VALUES ('documents', 'local-1', 1, 'read', '', '2026-08-24')
    `);

    await ensureSqlTables(execSql, [documentsTable]);

    expect(
      await execSql(
        "SELECT local_id, pull_continuation, recovery_generation FROM documents WHERE local_id = 'local-1'",
      ),
    ).toEqual([
      {
        local_id: "local-1",
        pull_continuation: null,
        recovery_generation: 0,
      },
    ]);
  } finally {
    close();
  }
});

test("additive schema ensure accepts a concurrent connection's DDL winner", async () => {
  const documentsTable = documentTables[0];
  if (!documentsTable) throw new Error("Documents table schema is missing");
  const legacyCreateSql = documentsTable.createSql.replace(
    '  "pull_continuation" TEXT,\n',
    "",
  );
  const columns = new Set<string>();
  let pragmaReads = 0;
  let alters = 0;
  const createRacingExecutor = () =>
    (async (sql: string) => {
      if (sql.startsWith("CREATE TABLE")) return [];
      if (sql.startsWith("PRAGMA table_info")) {
        pragmaReads += 1;
        if (pragmaReads <= 2) return [];
        return Array.from(columns, (name) => ({ name }));
      }
      if (sql.startsWith("ALTER TABLE")) {
        alters += 1;
        if (alters === 1) {
          columns.add("pull_continuation");
          return [];
        }
        throw new Error("duplicate column name: pull_continuation");
      }
      return [];
    }) as unknown as Parameters<typeof ensureSqlTables>[0];
  const firstConnection = createRacingExecutor();
  const secondConnection = createRacingExecutor();
  const racingTable = {
    ...documentsTable,
    additiveColumns:
      documentsTable.additiveColumns?.filter(
        ({ name }) => name === "pull_continuation",
      ) ?? [],
    createSql: legacyCreateSql,
    indexes: [],
    requiredColumns: [],
  };

  await Promise.all([
    ensureSqlTables(firstConnection, [racingTable]),
    ensureSqlTables(secondConnection, [racingTable]),
  ]);

  expect(alters).toBe(2);
  expect(columns.has("pull_continuation")).toBe(true);
});
