import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "./schema";
import type { ExecSql } from "./sqlExec";
import {
  resetConnectionSchemaMemo,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "./sqlExec";
import { ensureSqlTables } from "./sqlTableSchema";

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
