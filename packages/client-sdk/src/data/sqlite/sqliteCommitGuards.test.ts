import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { registerClientSQLiteCommitGuard } from "./sqliteCommitGuards";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "./sqlSchema";

for (const guardedOuter of [false, true]) {
  test(`nested lifetime guards gate the outer commit (guarded: ${guardedOuter})`, async () => {
    const database = await createTestExecSql("nested-commit-guard");
    const expired = new Error("Identity expired after nested work");
    let current = true;
    try {
      await database.execSql("CREATE TABLE commit_guard_probe (value INTEGER)");
      await expect(
        runSerializedSqlMutation(database.execSql, async (execSql) => {
          const runtime = getClientSQLitePersistenceRuntime(execSql);
          const operation = async () => {
            await runtime.transaction(async () => {
              registerClientSQLiteCommitGuard(execSql, () => {
                if (!current) throw expired;
              });
              await execSql("INSERT INTO commit_guard_probe VALUES (1)");
            });
            await Promise.resolve();
            current = false;
          };
          if (guardedOuter)
            await runtime.guardedTransaction(operation, () => true);
          else await runtime.transaction(operation);
        }),
      ).rejects.toBe(expired);
      expect(
        await database.execSql("SELECT value FROM commit_guard_probe"),
      ).toEqual([]);
      // A rolled-back guard never contaminates a later transaction.
      await getClientSQLitePersistenceRuntime(database.execSql).transaction(
        async () => {},
      );
    } finally {
      database.close();
    }
  });
}

test("commit guards require a transaction owner", async () => {
  const database = await createTestExecSql("commit-guard-owner");
  try {
    expect(() =>
      registerClientSQLiteCommitGuard(database.execSql, () => {}),
    ).toThrow("active runtime transaction");
  } finally {
    database.close();
  }
});

for (const guardedOuter of [false, true]) {
  test(`rolled-back savepoints release only their own commit guards (guarded: ${guardedOuter})`, async () => {
    const database = await createTestExecSql("rolled-back-commit-guard");
    const nestedFailure = new Error("Nested operation failed");
    let nestedCurrent = true;
    let outerChecks = 0;
    try {
      await database.execSql("CREATE TABLE commit_guard_probe (value INTEGER)");
      await runSerializedSqlMutation(database.execSql, async (execSql) => {
        const runtime = getClientSQLitePersistenceRuntime(execSql);
        const operation = async () => {
          registerClientSQLiteCommitGuard(execSql, () => {
            outerChecks++;
          });
          await expect(
            runtime.transaction(async () => {
              registerClientSQLiteCommitGuard(execSql, () => {
                if (!nestedCurrent)
                  throw new Error("Rolled-back lease expired");
              });
              await execSql("INSERT INTO commit_guard_probe VALUES (1)");
              throw nestedFailure;
            }),
          ).rejects.toBe(nestedFailure);
          nestedCurrent = false;
          await execSql("INSERT INTO commit_guard_probe VALUES (2)");
        };
        if (guardedOuter)
          await runtime.guardedTransaction(operation, () => true);
        else await runtime.transaction(operation);
      });
      expect(
        await database.execSql("SELECT value FROM commit_guard_probe"),
      ).toEqual([{ value: 2 }]);
      expect(outerChecks).toBe(2);
    } finally {
      database.close();
    }
  });
}
