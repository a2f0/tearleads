import { initDatabase } from "../src/loadSqlite3";
import { registerDatabaseWorker } from "../src/worker";

registerDatabaseWorker({
  onInit: async (options) => {
    await initDatabase(options);
  },
});
