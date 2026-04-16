import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { registerDatabaseWorker } from "@tearleads/sqlite-worker/worker";

let database: Awaited<ReturnType<typeof initDatabase>> | null = null;

// Registers the dedicated worker-thread handlers once. This worker keeps a
// single SQLite instance alive for its lifetime and answers init/exec requests
// from the main-thread database client.
registerDatabaseWorker({
  onInit: async (options) => {
    if (database) {
      throw new Error("Database has already been initialized.");
    }

    database = await initDatabase(options);
  },
  onExec: async (options) => {
    if (!database) {
      throw new Error("Database has not been initialized.");
    }

    return execDatabaseStatement(database, options);
  },
});
