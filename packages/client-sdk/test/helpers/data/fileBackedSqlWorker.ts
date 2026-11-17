import { Database } from "bun:sqlite";
import type { DatabaseWorkerExecResult } from "@tearleads/sqlite-worker/types";
import { registerDatabaseWorker } from "@tearleads/sqlite-worker/worker";

// Native file-backed SQLite behind the production worker protocol. This tests
// new-connection durability and real messages, not browser OPFS or encryption.
let database: Database | null = null;
registerDatabaseWorker({
  onInit({ dbName }) {
    database = new Database(dbName);
  },
  onExec({ sql, bind, rowMode }) {
    if (!database) throw new Error("Database not initialized");
    if (bind === undefined && /;\s*\S/.test(sql.trim().replace(/;\s*$/, ""))) {
      database.exec(sql);
      return [];
    }
    const parameters = Array.isArray(bind)
      ? [...bind]
      : bind === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(bind).map(([key, value]) => [
              /^[$:@]/.test(key) ? key : `$${key}`,
              value,
            ]),
          );
    const statement = database.query(sql);
    try {
      return (
        rowMode === "array"
          ? parameters === undefined
            ? statement.values()
            : statement.values(parameters as never)
          : parameters === undefined
            ? statement.all()
            : statement.all(parameters as never)
      ) as DatabaseWorkerExecResult["rows"];
    } finally {
      statement.finalize();
    }
  },
  onClose() {
    database?.close();
    database = null;
  },
});
