import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { getClientSQLitePersistenceRuntime } from "./sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "./sqlSchema";

async function createProbeTable(name: string) {
  const { close, execSql } = await createTestExecSql(name);
  await execSql(
    "CREATE TABLE IF NOT EXISTS nested_tx_probe (id TEXT PRIMARY KEY)",
  );
  const insert = (lockedExecSql: typeof execSql, id: string) =>
    lockedExecSql("INSERT INTO nested_tx_probe (id) VALUES (?)", [id]);
  const ids = async () =>
    (
      await execSql("SELECT id FROM nested_tx_probe ORDER BY id", [], {
        rowMode: "array",
      })
    ).flat();
  return { close, execSql, ids, insert };
}

test("a nested runtime transaction commits with its outer transaction", async () => {
  const { close, execSql, ids, insert } = await createProbeTable(
    "nested-transaction-commit",
  );
  try {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
      await runtime.transaction(async () => {
        await insert(lockedExecSql, "outer");
        // A helper that opens its own runtime.transaction while ours is
        // open must join it as a savepoint, not fail on a second BEGIN.
        await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
          async () => {
            await insert(lockedExecSql, "inner");
          },
        );
      });
    });

    expect(await ids()).toEqual(["inner", "outer"]);
  } finally {
    close();
  }
});

test("a failed nested transaction rolls back only its savepoint", async () => {
  const { close, execSql, ids, insert } = await createProbeTable(
    "nested-transaction-inner-rollback",
  );
  try {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
      await runtime.transaction(async () => {
        await insert(lockedExecSql, "outer");
        await getClientSQLitePersistenceRuntime(lockedExecSql)
          .transaction(async () => {
            await insert(lockedExecSql, "inner");
            throw new Error("inner failure");
          })
          .catch((error: unknown) => {
            expect(String(error)).toContain("inner failure");
          });
        await insert(lockedExecSql, "outer-after");
      });
    });

    expect(await ids()).toEqual(["outer", "outer-after"]);
  } finally {
    close();
  }
});

test("an outer rollback discards nested writes released as savepoints", async () => {
  const { close, execSql, ids, insert } = await createProbeTable(
    "nested-transaction-outer-rollback",
  );
  try {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
      await runtime
        .transaction(async () => {
          await insert(lockedExecSql, "outer");
          await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
            async () => {
              await insert(lockedExecSql, "inner");
            },
          );
          throw new Error("outer failure");
        })
        .catch((error: unknown) => {
          expect(String(error)).toContain("outer failure");
        });
    });

    expect(await ids()).toEqual([]);
  } finally {
    close();
  }
});

test("sequential top-level transactions still begin fresh", async () => {
  const { close, execSql, ids, insert } = await createProbeTable(
    "nested-transaction-sequential",
  );
  try {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async () => insert(lockedExecSql, "first"),
      );
    });
    // The depth bookkeeping must have returned to zero: this second
    // top-level transaction issues a fresh BEGIN, not a savepoint.
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async () => insert(lockedExecSql, "second"),
      );
    });

    expect(await ids()).toEqual(["first", "second"]);
  } finally {
    close();
  }
});

test("overlapping sibling nested scopes serialize on the savepoint stack", async () => {
  const { close, execSql, ids, insert } = await createProbeTable(
    "nested-transaction-sibling-overlap",
  );
  try {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
      await runtime.transaction(async () => {
        // Two sibling scopes started concurrently: without serialization
        // they would interleave SAVEPOINT/RELEASE on the shared stack and
        // the failing sibling's rollback would swallow the other's write.
        const results = await Promise.allSettled([
          getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
            async () => {
              await insert(lockedExecSql, "sibling-kept");
            },
          ),
          getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
            async () => {
              await insert(lockedExecSql, "sibling-dropped");
              throw new Error("sibling failure");
            },
          ),
        ]);
        expect(results.map((result) => result.status)).toEqual([
          "fulfilled",
          "rejected",
        ]);
      });
    });

    expect(await ids()).toEqual(["sibling-kept"]);
  } finally {
    close();
  }
});

test("guardedTransaction rolls everything back when the guard refuses", async () => {
  const { close, execSql, ids, insert } = await createProbeTable(
    "guarded-transaction-refusal",
  );
  try {
    let allow = true;
    const outcome = await runSerializedSqlMutation(
      execSql,
      async (lockedExecSql) =>
        getClientSQLitePersistenceRuntime(lockedExecSql).guardedTransaction(
          async () => {
            await insert(lockedExecSql, "doomed");
            // Nested helper transactions must still join as savepoints.
            await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
              async () => insert(lockedExecSql, "doomed-nested"),
            );
            allow = false;
          },
          () => allow,
        ),
    );

    expect(outcome.committed).toBe(false);
    expect(await ids()).toEqual([]);
  } finally {
    close();
  }
});

test("three-level nesting releases savepoints innermost first", async () => {
  const { close, execSql, ids, insert } = await createProbeTable(
    "nested-transaction-three-levels",
  );
  try {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
      await runtime.transaction(async () => {
        await insert(lockedExecSql, "level-1");
        await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
          async () => {
            await insert(lockedExecSql, "level-2");
            // A descendant scope must start immediately instead of waiting
            // behind its own unresolved parent on the scope chain.
            await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
              async () => {
                await insert(lockedExecSql, "level-3");
              },
            );
          },
        );
      });
    });

    expect(await ids()).toEqual(["level-1", "level-2", "level-3"]);
  } finally {
    close();
  }
});

test("a failed BEGIN leaves the runtime able to transact again", async () => {
  const { close, execSql } = await createProbeTable(
    "guarded-transaction-begin-failure",
  );
  try {
    let failNextBegin = true;
    const flaky = (async (sql, bind, options) => {
      if (failNextBegin && sql === "BEGIN") {
        failNextBegin = false;
        throw new Error("simulated BEGIN failure");
      }
      return execSql(sql, bind, options);
    }) as typeof execSql;

    const runtime = getClientSQLitePersistenceRuntime(flaky);
    await expect(
      runtime.guardedTransaction(
        async () => undefined,
        () => true,
      ),
    ).rejects.toThrow("simulated BEGIN failure");

    // The depth bookkeeping must have been cleared by the failure: a stale
    // depth would reject this fresh transaction as illegally nested instead
    // of issuing a real BEGIN.
    const outcome = await runtime.guardedTransaction(
      async () => undefined,
      () => true,
    );
    expect(outcome.committed).toBe(true);
  } finally {
    close();
  }
});
