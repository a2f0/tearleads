import { expect, spyOn, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "./schema";
import type { ExecSql } from "./sqlExec";
import {
  resetConnectionSchemaMemo,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "./sqlExec";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import { ensureSqlTables, type SqlTableSchema } from "./sqlTableSchema";

// The spy is a distinct function identity, so the memo (and mutation lock)
// under test keys on the spy itself rather than the wrapped executor. That is
// deliberate: it gives each test an isolated memo universe. Unwrapping the spy
// would silently change what these assertions exercise.
function createSpyExecSql(execSql: ExecSql): {
  calls: string[];
  spyExecSql: ExecSql;
} {
  const calls: string[] = [];
  const spyExecSql = ((
    sql: string,
    bind?: Parameters<ExecSql>[1],
    options?: { rowMode?: "object" | "array" },
  ) => {
    calls.push(sql);
    return execSql(sql, bind, options);
  }) as ExecSql;
  return { calls, spyExecSql };
}

test("ensureSqlTables runs once per connection", async () => {
  const { close, execSql } = await createTestExecSql("ensure-schema-memo");
  try {
    const { calls, spyExecSql } = createSpyExecSql(execSql);

    await ensureSqlTables(spyExecSql, documentTables);
    const callsAfterFirstEnsure = calls.length;
    expect(callsAfterFirstEnsure).toBeGreaterThan(0);

    // A re-ensure of already-ensured tables issues no SQL at all — it must not
    // even take the serialized mutation lock, since diagnostic reads re-ensure
    // on every query and would otherwise queue behind bulk-import writes.
    await ensureSqlTables(spyExecSql, documentTables);
    expect(calls.length).toBe(callsAfterFirstEnsure);

    // A schema rebuild (local backup restore) forgets the memo, so ensures run
    // again on the next query.
    resetConnectionSchemaMemo(spyExecSql);
    await ensureSqlTables(spyExecSql, documentTables);
    expect(calls.length).toBeGreaterThan(callsAfterFirstEnsure);
  } finally {
    close();
  }
});

test("runOncePerConnection shares completion across lock contexts without sharing in-flight promises", async () => {
  const { close, execSql } = await createTestExecSql("once-per-connection");
  try {
    let runs = 0;

    // First completion happens inside a held mutation lock, through the locked
    // executor identity...
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await runOncePerConnection(lockedExecSql, "memo-key", async () => {
        runs += 1;
      });
    });
    // ...and the canonical executor still sees it as done: locked wrappers map
    // back to the canonical connection identity.
    await runOncePerConnection(execSql, "memo-key", async () => {
      runs += 1;
    });
    expect(runs).toBe(1);

    // Distinct keys are independent.
    await runOncePerConnection(execSql, "other-key", async () => {
      runs += 1;
    });
    expect(runs).toBe(2);
  } finally {
    close();
  }
});

test("outermost mutations draw their queue wait and lock hold on User Timing tracks", async () => {
  const measure = spyOn(performance, "measure");
  const execSql: ExecSql = (async () => []) as ExecSql;
  try {
    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      // A nested call reuses the held lock and draws nothing of its own.
      await runSerializedSqlMutation(lockedExecSql, async () => {});
      await firstHeld;
    });
    const second = runSerializedSqlMutation(execSql, async () => {
      throw new Error("constraint failed");
    });
    releaseFirst();
    await first;
    await expect(second).rejects.toThrow("constraint failed");

    expect(
      measure.mock.calls.map(([name, options]) => [
        name,
        typeof options === "object" ? options.detail.devtools.color : null,
      ]),
    ).toEqual([
      ["SQLite mutation", "primary"],
      ["SQLite mutation wait", "primary"],
      ["SQLite mutation", "error"],
    ]);
  } finally {
    measure.mockRestore();
  }
});

function memoTable(name: string): SqlTableSchema {
  return { name, createSql: `CREATE TABLE IF NOT EXISTS ${name} (id TEXT)` };
}

async function tableExists(execSql: ExecSql, name: string): Promise<boolean> {
  const rows = await execSql(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return rows.length > 0;
}

// Runs `operation` in a runtime transaction on the locked executor, the way
// persistence helpers nest ensures inside their transactions.
function inTransaction(
  execSql: ExecSql,
  operation: (lockedExecSql: ExecSql) => Promise<void>,
): Promise<void> {
  return runSerializedSqlMutation(execSql, (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(() =>
      operation(lockedExecSql),
    ),
  );
}

test("a rolled-back transaction forgets only the schema it first ensured", async () => {
  const { close, execSql } = await createTestExecSql("ensure-memo-rollback");
  try {
    const { calls, spyExecSql } = createSpyExecSql(execSql);
    const kept = memoTable("memo_kept");
    const undone = memoTable("memo_undone");
    await ensureSqlTables(spyExecSql, [kept]);

    await expect(
      inTransaction(spyExecSql, async (lockedExecSql) => {
        await ensureSqlTables(lockedExecSql, [kept, undone]);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(await tableExists(execSql, "memo_undone")).toBe(false);

    calls.length = 0;
    await ensureSqlTables(spyExecSql, [kept, undone]);
    expect(calls).toEqual([undone.createSql]);
    expect(await tableExists(execSql, "memo_undone")).toBe(true);
  } finally {
    close();
  }
});

test("savepoint ensures follow the savepoint and then the enclosing transaction", async () => {
  const { close, execSql } = await createTestExecSql("ensure-memo-savepoint");
  try {
    const { calls, spyExecSql } = createSpyExecSql(execSql);
    const released = memoTable("memo_released");
    const rolledBack = memoTable("memo_rolled_back");
    await inTransaction(spyExecSql, async (lockedExecSql) => {
      const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
      await expect(
        runtime.transaction(async () => {
          await ensureSqlTables(lockedExecSql, [rolledBack]);
          throw new Error("savepoint rolled back");
        }),
      ).rejects.toThrow("savepoint rolled back");
      await runtime.transaction(() =>
        ensureSqlTables(lockedExecSql, [released]),
      );
    });
    calls.length = 0;
    await ensureSqlTables(spyExecSql, [released, rolledBack]);
    expect(calls).toEqual([rolledBack.createSql]);

    // A released savepoint's ensure is undone by its enclosing rollback.
    const nested = memoTable("memo_nested");
    await expect(
      inTransaction(spyExecSql, async (lockedExecSql) => {
        await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(() =>
          ensureSqlTables(lockedExecSql, [nested]),
        );
        throw new Error("outer rolled back");
      }),
    ).rejects.toThrow("outer rolled back");
    calls.length = 0;
    await ensureSqlTables(spyExecSql, [released, nested]);
    expect(calls).toEqual([nested.createSql]);
    expect(await tableExists(execSql, "memo_nested")).toBe(true);
  } finally {
    close();
  }
});

test("a refused guarded transaction forgets the schema it first ensured", async () => {
  const { close, execSql } = await createTestExecSql("ensure-memo-guarded");
  try {
    const { calls, spyExecSql } = createSpyExecSql(execSql);
    const refused = memoTable("memo_refused");
    const outcome = await runSerializedSqlMutation(
      spyExecSql,
      (lockedExecSql) =>
        getClientSQLitePersistenceRuntime(lockedExecSql).guardedTransaction(
          () => ensureSqlTables(lockedExecSql, [refused]),
          () => false,
        ),
    );
    expect(outcome.committed).toBe(false);
    calls.length = 0;
    await ensureSqlTables(spyExecSql, [refused]);
    expect(calls).toEqual([refused.createSql]);
    expect(await tableExists(execSql, "memo_refused")).toBe(true);
  } finally {
    close();
  }
});
