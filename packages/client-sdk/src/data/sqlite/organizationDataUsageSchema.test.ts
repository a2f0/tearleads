import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  readTableColumns,
  requireColumn,
} from "../../../test/helpers/sqlitePragma";
import {
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
  organizationDataUsageTables,
} from "./organizationDataUsageSchema";
import { clientSQLiteSchema, clientSqlTables } from "./schema";
import { ensureSqlTables } from "./sqlTableSchema";

test("organization data usage schema is requester scoped and normalized", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-schema",
  );
  try {
    await ensureSqlTables(execSql, organizationDataUsageTables);
    const snapshots = await readTableColumns(
      execSql,
      "organization_data_usage_snapshots",
    );
    expect(requireColumn(snapshots, "organization_id")).toMatchObject({
      notNull: 1,
      pk: 1,
    });
    expect(requireColumn(snapshots, "requester_user_id")).toMatchObject({
      notNull: 1,
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
      expect(requireColumn(snapshots, name)).toMatchObject({
        notNull: 1,
        type: "INTEGER",
      });
    }
    expect(requireColumn(snapshots, "refreshed_at")).toMatchObject({
      notNull: 1,
      type: "TEXT",
    });

    const categories = await readTableColumns(
      execSql,
      "organization_data_usage_categories",
    );
    expect(requireColumn(categories, "organization_id")).toMatchObject({
      notNull: 1,
      pk: 1,
    });
    expect(requireColumn(categories, "requester_user_id")).toMatchObject({
      notNull: 1,
      pk: 2,
    });
    expect(requireColumn(categories, "category")).toMatchObject({
      notNull: 1,
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
