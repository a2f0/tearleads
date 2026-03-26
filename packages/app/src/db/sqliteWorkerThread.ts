import { initDatabase } from "@tearleads/sqlite-worker/load-sqlite3";
import { registerDatabaseWorker } from "@tearleads/sqlite-worker/worker";

registerDatabaseWorker({
  onInit: async (options) => {
    await initDatabase(options);
  },
});
