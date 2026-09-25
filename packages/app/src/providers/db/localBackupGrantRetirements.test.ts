import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";

const schema = `CREATE TABLE principal_grant_retirements (
  organization_id TEXT NOT NULL, container_id TEXT NOT NULL,
  principal_id TEXT NOT NULL, policy_state_hash TEXT NOT NULL,
  PRIMARY KEY (organization_id, container_id)
)`;
const row = ["org", "container", "group", "a".repeat(64)];

test("restoring an older backup preserves acknowledged grant retirements", async () => {
  const target = createNativeTestExecSql();
  try {
    await target.execSql(schema);
    await target.execSql(
      "INSERT INTO principal_grant_retirements VALUES (?, ?, ?, ?)",
      row,
    );
    const before = await readBackupDatabase({ execSql: target.execSql });
    await restoreBackupDatabase({
      execSql: target.execSql,
      indexes: [],
      tables: [],
    });
    expect(
      (await readBackupDatabase({ execSql: target.execSql })).tables,
    ).toEqual(before.tables);
  } finally {
    target.close();
  }
});

test("restore unions grant retirements by organization and container idempotently", async () => {
  const target = createNativeTestExecSql();
  const source = createNativeTestExecSql();
  try {
    for (const db of [target, source]) await db.execSql(schema);
    await target.execSql(
      "INSERT INTO principal_grant_retirements VALUES (?, ?, ?, ?)",
      row,
    );
    await source.execSql(
      "INSERT INTO principal_grant_retirements VALUES (?, ?, ?, ?)",
      ["other-org", ...row.slice(1)],
    );
    const backup = await readBackupDatabase({ execSql: source.execSql });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await restoreBackupDatabase({ ...backup, execSql: target.execSql });
      expect(
        await target.execSql(
          "SELECT organization_id FROM principal_grant_retirements ORDER BY organization_id",
        ),
      ).toEqual([{ organization_id: "org" }, { organization_id: "other-org" }]);
    }
  } finally {
    target.close();
    source.close();
  }
});

test.each(["principal_id", "policy_state_hash"])(
  "conflicting restored retirement %s leaves the database unchanged",
  async (column) => {
    const target = createNativeTestExecSql();
    try {
      await target.execSql(schema);
      await target.execSql(
        "INSERT INTO principal_grant_retirements VALUES (?, ?, ?, ?)",
        row,
      );
      const backup = await readBackupDatabase({ execSql: target.execSql });
      const tables = backup.tables.map((table) => ({
        ...table,
        rows: table.rows.map((value) => ({
          ...value,
          [column]: "b".repeat(64),
        })),
      }));
      await expect(
        restoreBackupDatabase({ ...backup, tables, execSql: target.execSql }),
      ).rejects.toThrow(
        "Backup disagrees with the local principal grant retirement",
      );
      expect(
        (await readBackupDatabase({ execSql: target.execSql })).tables,
      ).toEqual(backup.tables);
    } finally {
      target.close();
    }
  },
);
