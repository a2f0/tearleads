import { execDatabaseStatement, initDatabase } from "./loadSqlite3";
import { registerDatabaseWorker } from "./worker";

let database: Awaited<ReturnType<typeof initDatabase>> | null = null;

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
