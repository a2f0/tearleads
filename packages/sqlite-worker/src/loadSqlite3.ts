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
 * Invokes the untyped `sqlite3mc_vfs_create` SQLite3MultipleCiphers C export,
 * which is not part of the typed wasm CAPI. It wraps an already-registered VFS
 * (named `zVfsReal`) with the multiple-ciphers codec so that databases opened
 * against the wrapper support `PRAGMA key=` encryption; it returns 0 (SQLITE_OK)
 * on success.
 *
 * Read and called via `Reflect` so production sources stay free of type
 * assertions. Returns null when the build does not provide the export.
 */
function callCreateCipherVfs(
  s: Sqlite3Static,
  zVfsReal: string,
  makeDefault: number,
): number | null {
  const fn = Reflect.get(s.capi, "sqlite3mc_vfs_create");
  if (typeof fn !== "function") {
    return null;
  }

  const result = Reflect.apply(fn, s.capi, [zVfsReal, makeDefault]);
  return typeof result === "number" ? result : null;
}

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

interface PersistentVfs {
  readonly poolUtil: SAHPoolUtil;
  /**
   * Name of the cipher-capable VFS that databases must be opened against — the
   * multiple-ciphers wrapper around the SAHPool VFS. Opening against the bare
   * SAHPool VFS would reject `PRAGMA key=`.
   */
  readonly cipherVfsName: string;
}

let sqlite3: Sqlite3Static | undefined;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;
let persistentVfs: PersistentVfs | undefined;
let persistentVfsPromise: Promise<PersistentVfs> | undefined;
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
 * Wraps the SAHPool VFS with the SQLite3MultipleCiphers codec VFS and returns the
 * name of the resulting cipher-capable VFS.
 *
 * The bare SAHPool VFS does not implement the encryption hooks, so opening a
 * database against it makes `PRAGMA key=` fail with "Encryption is not supported
 * by the VFS." `sqlite3mc_vfs_create` registers a wrapper VFS (conventionally
 * named `multipleciphers-<real>`) that delegates I/O to SAHPool while adding the
 * codec. We resolve the wrapper's actual name from the live VFS list rather than
 * assuming the prefix, so a build-specific naming change cannot silently regress.
 */
function createCipherVfs(s: Sqlite3Static, underlyingVfsName: string): string {
  const before = new Set(s.capi.sqlite3_js_vfs_list());
  const rc = callCreateCipherVfs(s, underlyingVfsName, 0);
  if (rc === null) {
    throw new Error(
      "Persistent storage requested but the SQLite build does not provide sqlite3mc_vfs_create.",
    );
  }
  if (rc !== 0) {
    throw new Error(
      `Failed to create the multiple-ciphers VFS over ${underlyingVfsName} (rc=${rc}).`,
    );
  }

  const created = s.capi
    .sqlite3_js_vfs_list()
    .filter((name) => !before.has(name));
  // Prefer a wrapper whose name references the underlying VFS; fall back to the
  // single newly-registered VFS if the naming convention ever changes.
  const cipherVfsName =
    created.find((name) => name.includes(underlyingVfsName)) ?? created[0];
  if (!cipherVfsName) {
    throw new Error(
      "The multiple-ciphers VFS was created but could not be located in the VFS list.",
    );
  }

  return cipherVfsName;
}

/**
 * Installs (once) the persistent VFS stack: the OPFS SyncAccessHandle Pool VFS
 * wrapped by the SQLite3MultipleCiphers codec VFS.
 *
 * The VFSes are registered globally in the WASM instance, so they must be set up
 * exactly once and reused across every database opened in this worker (e.g. the
 * bootstrap database and the per-identity database). The SAHPool VFS is
 * synchronous and therefore needs neither `SharedArrayBuffer` nor cross-origin
 * isolation (COOP/COEP).
 *
 * Throws if OPFS is unavailable or the VFS stack cannot be installed —
 * persistence is a hard requirement once requested, never a silent fall back to
 * memory.
 */
async function loadPersistentVfs(s: Sqlite3Static): Promise<PersistentVfs> {
  if (persistentVfs) {
    return persistentVfs;
  }

  if (typeof s.installOpfsSAHPoolVfs !== "function") {
    throw new Error(
      "Persistent storage requested but the SQLite build does not provide installOpfsSAHPoolVfs.",
    );
  }

  if (!persistentVfsPromise) {
    persistentVfsPromise = (async () => {
      const poolUtil = await s.installOpfsSAHPoolVfs({
        name: SAHPOOL_VFS_NAME,
        directory: SAHPOOL_DIRECTORY,
        // Preserve existing files across sessions — this is the whole point.
        clearOnInit: false,
      });
      await poolUtil.reserveMinimumCapacity(SAHPOOL_MINIMUM_CAPACITY);
      const cipherVfsName = createCipherVfs(s, poolUtil.vfsName);
      const resolved: PersistentVfs = { poolUtil, cipherVfsName };
      persistentVfs = resolved;
      return resolved;
    })().catch((error: unknown) => {
      // Allow a later attempt to retry rather than caching a rejected promise.
      persistentVfsPromise = undefined;
      throw error instanceof Error
        ? error
        : new Error("Failed to install the persistent SQLite VFS.", {
            cause: error,
          });
    });
  }

  return persistentVfsPromise;
}

async function openDatabaseForMode(
  s: Sqlite3Static,
  dbName: string,
  persistence: DatabasePersistenceMode,
): Promise<InstanceType<Sqlite3Static["oo1"]["DB"]>> {
  if (persistence === "memory") {
    return new s.oo1.DB(dbName);
  }

  const { cipherVfsName } = await loadPersistentVfs(s);
  // Open against the cipher-capable wrapper VFS (not the bare SAHPool VFS) so the
  // encryption PRAGMAs below succeed. "c" = create-if-missing, read/write.
  return new s.oo1.DB(dbName, "c", cipherVfsName);
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
