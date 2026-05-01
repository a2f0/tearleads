import { expect, test } from "bun:test";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import { appSqlTables, defineSqlTableSchema } from "./schema";
import {
  type ExecSql,
  ensureSqlTables,
  type SqlRow,
  type SqlRowValue,
} from "./sqlSchema";

interface ColumnInfo {
  defaultValue: string | null;
  notNull: number;
  pk: number;
  type: string;
}

function readString(row: SqlRow, key: string): string {
  return String(row[key] ?? "");
}

function readNullableString(row: SqlRow, key: string): string | null {
  const value: SqlRowValue | undefined = row[key];
  return value === null || value === undefined ? null : String(value);
}

function readNumber(row: SqlRow, key: string): number {
  return Number(row[key] ?? 0);
}

function renderPragmaIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function readRecordValue<T>(record: Record<string, T>, key: string): T {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`Missing record value for ${key}`);
  }

  return value;
}

async function readTableColumns(
  execSql: ExecSql,
  tableName: string,
): Promise<Record<string, ColumnInfo>> {
  const rows = await execSql(
    `PRAGMA table_info(${renderPragmaIdentifier(tableName)})`,
  );

  return Object.fromEntries(
    rows.map((row) => [
      readString(row, "name"),
      {
        defaultValue: readNullableString(row, "dflt_value"),
        notNull: readNumber(row, "notnull"),
        pk: readNumber(row, "pk"),
        type: readString(row, "type"),
      },
    ]),
  );
}

async function readIndexList(
  execSql: ExecSql,
  tableName: string,
): Promise<Record<string, { partial: number; unique: number }>> {
  const rows = await execSql(`PRAGMA index_list(${tableName})`);

  return Object.fromEntries(
    rows.map((row) => [
      readString(row, "name"),
      {
        partial: readNumber(row, "partial"),
        unique: readNumber(row, "unique"),
      },
    ]),
  );
}

async function readIndexColumns(
  execSql: ExecSql,
  indexName: string,
): Promise<string[]> {
  const rows = await execSql(`PRAGMA index_info(${indexName})`);
  return rows.map((row) => readString(row, "name"));
}

test("app sqlite schema creates tables and indexes", async () => {
  const { close, execSql } = await createTestExecSql("app-schema-test");

  try {
    await ensureSqlTables(execSql, appSqlTables);

    const objects = await execSql(`
      SELECT name, type
      FROM sqlite_master
      WHERE type IN ('table', 'index')
        AND name NOT LIKE 'sqlite_autoindex%'
      ORDER BY type ASC, name ASC
    `);

    const tableNames = objects
      .filter((row) => readString(row, "type") === "table")
      .map((row) => readString(row, "name"));
    const indexNames = objects
      .filter((row) => readString(row, "type") === "index")
      .map((row) => readString(row, "name"));

    expect(tableNames).toEqual(appSqlTables.map((table) => table.name).sort());
    expect(indexNames).toEqual([
      "address_book_projection_self_idx",
      "container_create_intents_status_created_idx",
    ]);

    const documents = await readTableColumns(execSql, "documents");
    expect(readRecordValue(documents, "app_kind")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 1,
      type: "TEXT",
    });
    expect(readRecordValue(documents, "local_id")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 2,
      type: "TEXT",
    });
    expect(readRecordValue(documents, "access_epoch")).toEqual({
      defaultValue: "1",
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });

    const pendingUpdates = await readTableColumns(
      execSql,
      "document_pending_updates",
    );
    expect(readRecordValue(pendingUpdates, "id")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 1,
      type: "TEXT",
    });

    const addressBookIndexes = await readIndexList(
      execSql,
      "address_book_projection",
    );
    expect(
      readRecordValue(addressBookIndexes, "address_book_projection_self_idx"),
    ).toEqual({
      partial: 1,
      unique: 1,
    });
    expect(
      await readIndexColumns(execSql, "address_book_projection_self_idx"),
    ).toEqual(["address_book_id"]);

    const intentIndexes = await readIndexList(
      execSql,
      "container_create_intents",
    );
    expect(
      readRecordValue(
        intentIndexes,
        "container_create_intents_status_created_idx",
      ),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(
        execSql,
        "container_create_intents_status_created_idx",
      ),
    ).toEqual(["sync_status", "created_at"]);
  } finally {
    close();
  }
});

test("app sqlite schema renderer quotes identifiers and table unique constraints", async () => {
  const tableSchema = defineSqlTableSchema(
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
    const columns = await readTableColumns(execSql, "select");

    expect(readRecordValue(columns, "enabled")).toEqual({
      defaultValue: "1",
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });
    expect(readRecordValue(columns, "from")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
  } finally {
    close();
  }
});
