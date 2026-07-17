import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelTables } from "./schema";
import type { ExecSql, SqlRow } from "./sqlSchema";
import { ensureSqlTables } from "./sqlTableSchema";

interface ColumnInfo {
  notNull: number;
  pk: number;
  type: string;
}

function readString(row: SqlRow, key: string): string {
  return String(row[key] ?? "");
}

function readNumber(row: SqlRow, key: string): number {
  return Number(row[key] ?? 0);
}

async function readTableColumns(
  execSql: ExecSql,
  tableName: string,
): Promise<Record<string, ColumnInfo>> {
  const rows = await execSql(`PRAGMA table_info("${tableName}")`);
  return Object.fromEntries(
    rows.map((row) => [
      readString(row, "name"),
      {
        notNull: readNumber(row, "notnull"),
        pk: readNumber(row, "pk"),
        type: readString(row, "type"),
      },
    ]),
  );
}

function requireColumn(
  columns: Record<string, ColumnInfo>,
  name: string,
): ColumnInfo {
  const column = columns[name];
  if (!column) {
    throw new Error(`Missing column ${name}`);
  }
  return column;
}

test("organization read model schema stores group membership heads and rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-schema-test",
  );
  try {
    await ensureSqlTables(execSql, organizationReadModelTables);

    const memberships = await readTableColumns(
      execSql,
      "organization_read_model_group_memberships",
    );
    expect(requireColumn(memberships, "group_id")).toMatchObject({
      notNull: 1,
      pk: 2,
    });
    expect(requireColumn(memberships, "state_hash")).toEqual({
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });

    const members = await readTableColumns(
      execSql,
      "organization_read_model_group_members",
    );
    expect(requireColumn(members, "member_principal_type")).toMatchObject({
      notNull: 1,
      pk: 3,
    });
    expect(requireColumn(members, "member_principal_id")).toMatchObject({
      notNull: 1,
      pk: 4,
    });
  } finally {
    close();
  }
});
