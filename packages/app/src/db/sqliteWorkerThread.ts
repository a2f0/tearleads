import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { registerDatabaseWorker } from "@tearleads/sqlite-worker/worker";

let db: Awaited<ReturnType<typeof initDatabase>> | null = null;

registerDatabaseWorker({
  onInit: async (options) => {
    if (db) {
      throw new Error("Database has already been initialized.");
    }

    db = await initDatabase(options);
  },
  onExec: async (options) => {
    if (!db) {
      throw new Error("Database has not been initialized.");
    }

    return execDatabaseStatement(db, options);
  },
});
