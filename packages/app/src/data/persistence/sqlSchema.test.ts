import { expect, test } from "bun:test";
import {
  createExecSql,
  type ExecSql,
  runSerializedSqlMutation,
  type SqlRow,
  type SqlRowValue,
} from "./sqlSchema";

function createLoggingExecSql(log: string[]): ExecSql {
  return async (
    sql: string,
    _bind?: Record<string, SqlRowValue>,
  ): Promise<SqlRow[]> => {
    log.push(sql);
    return [];
  };
}

test("serialized mutations continue after a queued mutation fails", async () => {
  const statements: string[] = [];
  const execSql = createLoggingExecSql(statements);

  let releaseFirst = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const firstMutation = runSerializedSqlMutation(
    execSql,
    async (lockedExecSql) => {
      await lockedExecSql("first");
      releaseFirst();
      await Promise.resolve();
      throw new Error("boom");
    },
  );

  await firstStarted;

  const secondMutation = runSerializedSqlMutation(
    execSql,
    async (lockedExecSql) => {
      await lockedExecSql("second");
      return "ok";
    },
  );

  await expect(firstMutation).rejects.toThrow("boom");
  await expect(secondMutation).resolves.toBe("ok");
  expect(statements).toEqual(["first", "second"]);
});

test("nested mutations reuse the locked executor without blocking", async () => {
  const statements: string[] = [];
  const execSql = createLoggingExecSql(statements);

  await expect(
    runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql("outer");
      await runSerializedSqlMutation(lockedExecSql, async (nestedExecSql) => {
        await nestedExecSql("inner");
      });
    }),
  ).resolves.toBeUndefined();

  expect(statements).toEqual(["outer", "inner"]);
});

test("createExecSql reuses the same executor for the same client", () => {
  const client = {
    exec: async () => ({ rows: [] as SqlRow[] }),
  };

  expect(createExecSql(client)).toBe(createExecSql(client));
});

test("serialized mutations share a queue across adapters for the same client", async () => {
  const statements: string[] = [];
  let releaseFirst = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstReleased = false;

  const client = {
    exec: async ({
      sql,
    }: {
      sql: string;
      bind?: Record<string, SqlRowValue>;
    }): Promise<{ rows: SqlRow[] }> => {
      statements.push(sql);

      if (sql === "first") {
        releaseFirst();
        await new Promise<void>((resolve) => {
          const poll = () => {
            if (firstReleased) {
              resolve();
              return;
            }
            queueMicrotask(poll);
          };
          poll();
        });
      }

      return { rows: [] };
    },
  };

  const firstExecSql = createExecSql(client);
  const secondExecSql = createExecSql(client);

  const firstMutation = runSerializedSqlMutation(
    firstExecSql,
    async (lockedExecSql) => {
      await lockedExecSql("first");
      firstReleased = true;
    },
  );

  await firstStarted;

  const secondMutation = runSerializedSqlMutation(
    secondExecSql,
    async (lockedExecSql) => {
      await lockedExecSql("second");
    },
  );

  await expect(firstMutation).resolves.toBeUndefined();
  await expect(secondMutation).resolves.toBeUndefined();
  expect(statements).toEqual(["first", "second"]);
});
