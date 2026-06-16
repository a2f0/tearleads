import type { Sqlite3Static } from "@tearleads/sqlite-instance";
import sqlite3InitModule from "@tearleads/sqlite-instance/jswasm/sqlite3.mjs";
import type {
  DatabasePersistenceMode,
  DatabaseWorkerExecOptions,
  DatabaseWorkerInitOptions,
  SqliteArrayRow,
  SqliteObjectRow,
  SqliteRow,
} from "./types";

type SAHPoolUtil = Awaited<ReturnType<Sqlite3Static["installOpfsSAHPoolVfs"]>>;

/**
 * OPFS directory and registered VFS name for the persistent SAHPool. Kept stable
 * across sessions so a reload re-attaches to the same on-disk pool. Bumping these
 * would orphan previously persisted databases, so treat them as a storage
 * contract, not a tunable.
 */
const SAHPOOL_VFS_NAME = "tearleads-opfs-sahpool";
const SAHPOOL_DIRECTORY = "/tearleads-sqlite";

/**
 * The pool reserves one access handle per file it manages, including journal and
 * temp files, and across the few databases a session may open (bootstrap +
 * per-identity). Reserve enough headroom that opening a new identity database
 * never fails for lack of a slot.
 */
const SAHPOOL_MINIMUM_CAPACITY = 12;

let sqlite3: Sqlite3Static | undefined;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;
let sahPoolUtil: SAHPoolUtil | undefined;
let sahPoolPromise: Promise<SAHPoolUtil> | undefined;
let sqliteInitQueue = Promise.resolve();

function getBunFetch(): typeof fetch | null {
  return typeof Bun === "undefined" ? null : Bun.fetch;
}

function runWithBunFetchLock<T>(operation: () => Promise<T>): Promise<T> {
  const bunFetch = getBunFetch();
  if (!bunFetch) {
    return operation();
  }

  const nextOperation = sqliteInitQueue.then(async () => {
    const previousFetch = globalThis.fetch;
    // The generated SQLite/Emscripten loader calls bare fetch() while loading
    // sqlite3.wasm. In Bun, temporarily routing that global fetch call through
    // Bun.fetch keeps WASM loading working without patching generated files.
    globalThis.fetch = bunFetch;

    try {
      return await operation();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  sqliteInitQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}

export async function loadSqlite3(): Promise<Sqlite3Static> {
  if (sqlite3) {
    return sqlite3;
  }

  if (!sqlite3Promise) {
    sqlite3Promise = runWithBunFetchLock(async () => {
      const instance = await sqlite3InitModule();
      sqlite3 = instance;
      return instance;
    });
  }

  return sqlite3Promise;
}

/**
 * Installs (once) the OPFS SyncAccessHandle Pool VFS and returns its util handle.
 *
 * The VFS is registered globally in the WASM instance under {@link SAHPOOL_VFS_NAME},
 * so it must be installed exactly once and reused across every database opened in
 * this worker (e.g. the bootstrap database and the per-identity database). The
 * SAHPool VFS is synchronous and therefore needs neither `SharedArrayBuffer` nor
 * cross-origin isolation (COOP/COEP).
 *
 * Throws if OPFS is unavailable or the VFS cannot be installed — persistence is
 * a hard requirement once requested, never a silent fall back to memory.
 */
async function loadSAHPoolVfs(s: Sqlite3Static): Promise<SAHPoolUtil> {
  if (sahPoolUtil) {
    return sahPoolUtil;
  }

  if (typeof s.installOpfsSAHPoolVfs !== "function") {
    throw new Error(
      "Persistent storage requested but the SQLite build does not provide installOpfsSAHPoolVfs.",
    );
  }

  if (!sahPoolPromise) {
    sahPoolPromise = (async () => {
      const util = await s.installOpfsSAHPoolVfs({
        name: SAHPOOL_VFS_NAME,
        directory: SAHPOOL_DIRECTORY,
        // Preserve existing files across sessions — this is the whole point.
        clearOnInit: false,
      });
      await util.reserveMinimumCapacity(SAHPOOL_MINIMUM_CAPACITY);
      sahPoolUtil = util;
      return util;
    })().catch((error: unknown) => {
      // Allow a later attempt to retry rather than caching a rejected promise.
      sahPoolPromise = undefined;
      throw error instanceof Error
        ? error
        : new Error("Failed to install the OPFS SAHPool VFS.", {
            cause: error,
          });
    });
  }

  return sahPoolPromise;
}

async function openDatabaseForMode(
  s: Sqlite3Static,
  dbName: string,
  persistence: DatabasePersistenceMode,
): Promise<InstanceType<Sqlite3Static["oo1"]["DB"]>> {
  if (persistence === "memory") {
    return new s.oo1.DB(dbName);
  }

  const poolUtil = await loadSAHPoolVfs(s);
  return new poolUtil.OpfsSAHPoolDb(dbName);
}

export async function initDatabase(
  options: DatabaseWorkerInitOptions,
): Promise<InstanceType<Sqlite3Static["oo1"]["DB"]>> {
  const s = await loadSqlite3();
  const persistence = options.persistence ?? "memory";

  return runWithBunFetchLock(async () => {
    const db = await openDatabaseForMode(s, options.dbName, persistence);
    db.exec(`PRAGMA cipher='${options.cipher}'`);
    db.exec(`PRAGMA key='${options.key}'`);
    return db;
  });
}

export function execDatabaseStatement(
  db: InstanceType<Sqlite3Static["oo1"]["DB"]>,
  options: DatabaseWorkerExecOptions,
): SqliteRow[] {
  if (options.rowMode === "array") {
    const rows: SqliteArrayRow[] = [];

    db.exec(options.sql, {
      ...(options.bind !== undefined ? { bind: options.bind } : {}),
      rowMode: "array",
      resultRows: rows,
    });

    return rows;
  }

  const rows: SqliteObjectRow[] = [];

  db.exec(options.sql, {
    ...(options.bind !== undefined ? { bind: options.bind } : {}),
    rowMode: "object",
    resultRows: rows,
  });

  return rows;
}
