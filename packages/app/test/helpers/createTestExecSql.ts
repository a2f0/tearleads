import { createExecSql, type ExecSql } from "@tearleads/client-sdk/sqlite";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";

export async function createTestExecSql(key: string): Promise<{
  close: () => void;
  execSql: ExecSql;
}> {
  const db = await initDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key,
  });

  return {
    close: () => db.close(),
    execSql: createExecSql({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options),
      }),
    }),
  };
}
