import {
  closeDatabase,
  deleteDatabase,
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
  onDelete: async () => {
    // Close the db and WIPE its persistent OPFS files (logout discarding local
    // data). Null the reference first, same invariant as onClose.
    const db = database;
    database = null;
    await deleteDatabase(db);
  },
});
