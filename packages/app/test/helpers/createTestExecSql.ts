import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { createExecSql as createClientExecSql } from "../../src/data/sqlite/sqlSchema";

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
    execSql: createClientExecSql({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options),
      }),
    }),
  };
}
