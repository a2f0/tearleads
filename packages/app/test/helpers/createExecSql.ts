import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import type { ExecSql } from "../../src/data/sqlSchema";

let sqliteInitQueue = Promise.resolve();

function runWithBunFetchLock<T>(operation: () => Promise<T>): Promise<T> {
  const nextOperation = sqliteInitQueue.then(async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = Bun.fetch;

    try {
      return await operation();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  sqliteInitQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}

export async function createExecSql(key: string): Promise<{
  close: () => void;
  execSql: ExecSql;
}> {
  const db = await runWithBunFetchLock(() =>
    initDatabase({
      dbName: `/${crypto.randomUUID()}.db`,
      cipher: "chacha20",
      key,
    }),
  );

  return {
    close: () => db.close(),
    execSql: async (sql, bind) =>
      execDatabaseStatement(db, bind ? { bind, sql } : { sql }),
  };
}
