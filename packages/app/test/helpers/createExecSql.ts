import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import type { ExecSql } from "../../src/data/persistence/sqlSchema";

export async function createExecSql(key: string): Promise<{
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
    execSql: async (sql, bind) =>
      execDatabaseStatement(db, bind ? { bind, sql } : { sql }),
  };
}
