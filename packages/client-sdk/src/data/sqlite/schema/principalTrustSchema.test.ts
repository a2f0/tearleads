import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { readTableColumns } from "../../../../test/helpers/sqlitePragma";
import { ensureSqlTables } from "../sqlTableSchema";
import { clientSqlTables } from "./index";

const column = (type: string, notNull: number, pk: number) => ({
  defaultValue: null,
  notNull,
  pk,
  type,
});

test("node rows carry liveness and nullable child hashes; checkpoints carry their owner", async () => {
  const { close, execSql } = await createTestExecSql("principal-trust-schema");
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    expect(await readTableColumns(execSql, "principal_history_nodes")).toEqual({
      scope_id: column("TEXT", 1, 1),
      organization_id: column("TEXT", 1, 0),
      hash: column("TEXT", 1, 2),
      reference_count: column("INTEGER", 1, 0),
      managed: column("INTEGER", 1, 0),
      left_hash: column("TEXT", 0, 0),
      right_hash: column("TEXT", 0, 0),
    });
    expect(
      await readTableColumns(execSql, "principal_policy_checkpoints"),
    ).toEqual({
      principal_type: column("TEXT", 1, 1),
      principal_id: column("TEXT", 1, 2),
      organization_id: column("TEXT", 1, 0),
      version: column("INTEGER", 0, 0),
      state_hash: column("TEXT", 0, 0),
      updated_at: column("TEXT", 0, 0),
    });
  } finally {
    close();
  }
});

test.each(["principal_history_nodes", "principal_policy_checkpoints"])(
  "an obsolete %s table asks for a local reset",
  async (table) => {
    const { close, execSql } = await createTestExecSql(`obsolete-${table}`);
    try {
      // Lacks the column the fold added (reference_count, organization_id).
      await execSql(
        `CREATE TABLE ${table} (principal_type TEXT, principal_id TEXT, scope_id TEXT, hash TEXT)`,
      );
      await expect(ensureSqlTables(execSql, clientSqlTables)).rejects.toThrow(
        `Local database schema for ${table} is obsolete; reset the local database before continuing`,
      );
    } finally {
      close();
    }
  },
);
