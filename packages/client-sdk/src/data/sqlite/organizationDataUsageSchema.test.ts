import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
  organizationDataUsageTables,
} from "./organizationDataUsageSchema";
import { clientSQLiteSchema, clientSqlTables } from "./schema";
import { ensureSqlTables } from "./sqlTableSchema";

interface ColumnInfo {
  readonly name: string;
  readonly notnull: number;
  readonly pk: number;
  readonly type: string;
}

interface SQLiteColumnRow {
  readonly name?: unknown;
  readonly notnull?: unknown;
  readonly pk?: unknown;
  readonly type?: unknown;
}

function column(
  tableColumns: Readonly<Record<string, ColumnInfo>>,
  name: string,
): ColumnInfo | undefined {
  return tableColumns[name];
}

async function columns(
  execSql: Parameters<typeof ensureSqlTables>[0],
  tableName: string,
): Promise<Record<string, ColumnInfo>> {
  const rows = await execSql(`PRAGMA table_info("${tableName}")`);
  return Object.fromEntries(
    rows.map((row) => {
      const sqliteColumn = row as SQLiteColumnRow;
      const info = {
        name: String(sqliteColumn.name ?? ""),
        notnull: Number(sqliteColumn.notnull ?? 0),
        pk: Number(sqliteColumn.pk ?? 0),
        type: String(sqliteColumn.type ?? ""),
      };
      return [info.name, info];
    }),
  );
}

test("organization data usage schema is requester scoped and normalized", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-schema",
  );
  try {
    await ensureSqlTables(execSql, organizationDataUsageTables);
    const snapshots = await columns(
      execSql,
      "organization_data_usage_snapshots",
    );
    expect(column(snapshots, "organization_id")).toMatchObject({
      notnull: 1,
      pk: 1,
    });
    expect(column(snapshots, "requester_user_id")).toMatchObject({
      notnull: 1,
      pk: 2,
    });
    for (const name of [
      "projection_version",
      "blob_count",
      "blob_byte_length",
      "document_byte_length",
      "document_count",
      "document_update_count",
      "total_byte_length",
    ]) {
      expect(snapshots[name]).toMatchObject({ notnull: 1, type: "INTEGER" });
    }
    expect(column(snapshots, "refreshed_at")).toMatchObject({
      notnull: 1,
      type: "TEXT",
    });

    const categories = await columns(
      execSql,
      "organization_data_usage_categories",
    );
    expect(column(categories, "organization_id")).toMatchObject({
      notnull: 1,
      pk: 1,
    });
    expect(column(categories, "requester_user_id")).toMatchObject({
      notnull: 1,
      pk: 2,
    });
    expect(column(categories, "category")).toMatchObject({
      notnull: 1,
      pk: 3,
    });
    expect(clientSqlTables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "organization_data_usage_snapshots",
        "organization_data_usage_categories",
      ]),
    );
    const snapshotsSchemaKey = "organizationDataUsageSnapshots";
    expect(clientSQLiteSchema[snapshotsSchemaKey]).toBe(
      organizationDataUsageSnapshots,
    );
    const categoriesSchemaKey = "organizationDataUsageCategories";
    expect(clientSQLiteSchema[categoriesSchemaKey]).toBe(
      organizationDataUsageCategories,
    );
  } finally {
    close();
  }
});
