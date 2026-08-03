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

test("organization read model schema stores exact policy heads and access lanes", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-schema-test",
  );
  try {
    await ensureSqlTables(execSql, organizationReadModelTables);

    const groups = await readTableColumns(
      execSql,
      "organization_read_model_groups",
    );
    expect("key_fingerprint" in groups).toBe(false);

    const policyHeads = await readTableColumns(
      execSql,
      "organization_read_model_policy_heads",
    );
    expect(requireColumn(policyHeads, "organization_id")).toMatchObject({
      notNull: 1,
      pk: 1,
    });
    expect(requireColumn(policyHeads, "principal_type")).toMatchObject({
      notNull: 1,
      pk: 2,
    });
    expect(requireColumn(policyHeads, "principal_id")).toMatchObject({
      notNull: 1,
      pk: 3,
    });
    for (const name of [
      "state_hash",
      "state_version",
      "key_epoch",
      "key_fingerprint",
      "member_count",
    ]) {
      expect(requireColumn(policyHeads, name).notNull).toBe(1);
    }

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
    // The member-kind column is gone, so the composite key is
    // (organizationId, groupId, userId) and userId sits third.
    expect(requireColumn(members, "user_id")).toMatchObject({
      notNull: 1,
      pk: 3,
    });

    const grants = await readTableColumns(
      execSql,
      "organization_read_model_container_grants",
    );
    expect(requireColumn(grants, "organization_id")).toMatchObject({
      notNull: 1,
      pk: 1,
    });
    expect(requireColumn(grants, "container_id")).toMatchObject({
      notNull: 1,
      pk: 2,
    });
    expect(requireColumn(grants, "subject_type")).toMatchObject({
      notNull: 1,
      pk: 3,
    });
    expect(requireColumn(grants, "subject_id")).toMatchObject({
      notNull: 1,
      pk: 4,
    });
    expect(requireColumn(grants, "metadata_access_epoch")).toEqual({
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });
    expect(requireColumn(grants, "organization_name")).toEqual({
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
  } finally {
    close();
  }
});
