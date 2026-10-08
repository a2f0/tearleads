import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { readTableColumns } from "../../../test/helpers/sqlitePragma";
import type { SqlTableSchema } from "./sqlSchema";
import { defineSqlTableSchema, ensureSqlTables } from "./sqlTableSchema";

test("client sqlite schema renderer quotes identifiers and table unique constraints", async () => {
  const tableSchema: SqlTableSchema = defineSqlTableSchema(
    sqliteTable(
      "select",
      {
        enabled: integer("enabled", { mode: "boolean" })
          .notNull()
          .default(true),
        from: text("from").notNull(),
      },
      (table) => [unique().on(table.from, table.enabled)],
    ),
  );
  const { close, execSql } = await createTestExecSql(
    "app-schema-renderer-test",
  );

  try {
    expect(tableSchema.createSql).toContain(
      'CREATE TABLE IF NOT EXISTS "select"',
    );
    expect(tableSchema.createSql).toContain(
      '"enabled" INTEGER NOT NULL DEFAULT 1',
    );
    expect(tableSchema.createSql).toContain('"from" TEXT NOT NULL');
    expect(tableSchema.createSql).toContain('UNIQUE ("from", "enabled")');

    await ensureSqlTables(execSql, [tableSchema]);
    const { enabled, from } = await readTableColumns(execSql, "select");

    expect(enabled).toEqual({
      defaultValue: "1",
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });
    expect(from).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
  } finally {
    close();
  }
});
