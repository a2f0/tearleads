import { expect, test } from "bun:test";
import {
  createExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../sqlExec";
import {
  type ObservedClientSqlMutation,
  type ObservedClientSqlStatement,
  observeClientSqlMutations,
  observeClientSqlStatements,
} from "./sqlObserver";

function fakeClient(): ExecSqlClientLike {
  return {
    exec: async ({ sql }) => {
      if (sql === "FAIL") throw new Error("boom");
      return { rows: [{ id: "1" }, { id: "2" }] };
    },
  };
}

test("observes statements and serialized mutation lock holds with bind counts only", async () => {
  const execSql = createExecSql(fakeClient());
  const statements: ObservedClientSqlStatement[] = [];
  const mutations: ObservedClientSqlMutation[] = [];
  const stopStmts = observeClientSqlStatements((stmt) => statements.push(stmt));
  const stopMuts = observeClientSqlMutations((mut) => mutations.push(mut));
  try {
    await execSql("SELECT * FROM items WHERE id = ?", ["secret-id"]);
    await runSerializedSqlMutation(execSql, async (locked) => {
      await locked("BEGIN IMMEDIATE");
      await locked("INSERT INTO items VALUES (?, ?)", ["a", "b"]);
      await locked("COMMIT");
    });
    await expect(execSql("FAIL")).rejects.toThrow("boom");
  } finally {
    stopStmts();
    stopMuts();
  }

  expect(statements).toHaveLength(5);
  expect(statements[0]).toMatchObject({
    sql: "SELECT * FROM items WHERE id = ?",
    bindCount: 1,
    rowCount: 2,
    inMutationLock: false,
    failed: false,
  });
  expect(statements[1]?.inMutationLock).toBe(true);
  expect(statements[2]).toMatchObject({
    sql: "INSERT INTO items VALUES (?, ?)",
    bindCount: 2,
    inMutationLock: true,
    failed: false,
  });
  expect(statements[4]).toMatchObject({
    sql: "FAIL",
    bindCount: 0,
    failed: true,
  });
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatchObject({
    statements: 3,
    failed: false,
  });
  expect(mutations[0]?.holdMs).toBeGreaterThanOrEqual(0);
});

test("stops observing after unsubscribe and guards against recursion", async () => {
  const execSql = createExecSql(fakeClient());
  let count = 0;
  const stop = observeClientSqlStatements(() => {
    count += 1;
    // Re-entrant call started inside an observer must not be observed again.
    void execSql("SELECT 2");
  });
  await execSql("SELECT 1");
  await Promise.resolve();
  stop();
  await execSql("SELECT 3");
  expect(count).toBe(1);
});
