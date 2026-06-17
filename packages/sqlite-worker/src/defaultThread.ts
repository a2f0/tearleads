import {
  closeDatabase,
  execDatabaseStatement,
  initDatabase,
} from "./loadSqlite3";
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
  onClose: async () => {
    // Release the db and the persistent VFS's OPFS access handles. Null the
    // reference so the worker is back to a pre-init state (a later init would be
    // a no-op in practice — the runtime terminates the worker right after — but
    // this keeps the invariant that `database` reflects an open handle).
    const db = database;
    database = null;
    await closeDatabase(db);
  },
});
