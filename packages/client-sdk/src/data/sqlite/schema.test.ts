import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { clientSqlTables } from "./schema";
import type { ExecSql, SqlRow, SqlRowValue, SqlTableSchema } from "./sqlSchema";
import { defineSqlTableSchema, ensureSqlTables } from "./sqlTableSchema";

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

test("client sqlite schema creates tables and indexes", async () => {
  const { close, execSql } = await createTestExecSql("app-schema-test");

  try {
    await ensureSqlTables(execSql, clientSqlTables);

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

    expect(tableNames).toEqual(
      clientSqlTables.map((table) => table.name).sort(),
    );
    expect(indexNames).toEqual([
      "container_create_intents_status_created_idx",
      "document_pending_updates_scope_created_idx",
      "documents_app_document_idx",
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

    const documentIndexes = await readIndexList(execSql, "documents");
    expect(
      readRecordValue(documentIndexes, "documents_app_document_idx"),
    ).toEqual({
      partial: 1,
      unique: 0,
    });
    expect(
      await readIndexColumns(execSql, "documents_app_document_idx"),
    ).toEqual(["app_kind", "document_id"]);

    const pendingUpdateIndexes = await readIndexList(
      execSql,
      "document_pending_updates",
    );
    expect(
      readRecordValue(
        pendingUpdateIndexes,
        "document_pending_updates_scope_created_idx",
      ),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(
        execSql,
        "document_pending_updates_scope_created_idx",
      ),
    ).toEqual(["app_kind", "local_id", "created_at"]);

    const containerSyncWatermarks = await readTableColumns(
      execSql,
      "container_sync_watermarks",
    );
    expect(readRecordValue(containerSyncWatermarks, "lane_kind")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 1,
      type: "TEXT",
    });
    expect(readRecordValue(containerSyncWatermarks, "lane_id")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 2,
      type: "TEXT",
    });
    expect(
      readRecordValue(containerSyncWatermarks, "watermark_updated_at"),
    ).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containerSyncWatermarks, "watermark_id")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });

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

    const containers = await readTableColumns(execSql, "containers");
    expect("created_at" in containers).toBe(false);
    expect("updated_at" in containers).toBe(false);
    expect(readRecordValue(containers, "local_created_at")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "local_updated_at")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "server_created_at")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "server_updated_at")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "builtin_kind")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
  } finally {
    close();
  }
});

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
