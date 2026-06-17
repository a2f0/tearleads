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

/**
 * Bounded retry for installing the SAHPool VFS when its OPFS sync access handles
 * are still held by a *previous* worker that has not finished releasing them.
 *
 * SAHPool takes exclusive `createSyncAccessHandle` locks on its OPFS files. On a
 * reload (or a second tab on the same origin) the old page's worker is torn down
 * — gracefully via the `close` path when we get the chance, but on a hard reload
 * the browser discards the old page before our teardown can run, and then only
 * releases its OPFS handles once the unloaded page is fully reclaimed. A new
 * worker that calls `installOpfsSAHPoolVfs` in that window loses the race and the
 * install throws a `NoModificationAllowedError` ("Access Handles cannot be
 * created if there is another open Access Handle...").
 *
 * Measured against the dev server, the old page's handles usually free within a
 * second or two of a reload, so we retry on a short wall-clock budget with capped
 * exponential backoff: quick early retries catch the common fast release, the
 * backoff cap keeps us from hammering `installOpfsSAHPoolVfs` (each failed attempt
 * logs one error per pool file), and the modest total window keeps a single boot
 * attempt from stalling for long. The provider re-attempts identity-database boot
 * a few times on `error` (see useEnsureDatabaseForIdentity), which is the outer
 * backstop for the rarer case where the handles take longer to release — each of
 * those attempts spawns a fresh worker that runs this retry again.
 *
 * This deliberately retries ONLY the lock-contention signature. A genuinely
 * unavailable backend — no OPFS, or `sqlite3.wasm` missing on an offline reload
 * with no service-worker cache — must still fail fast so the app surfaces its
 * boot-error UI (Explorer's Retry surface keys off `status: "error"`); we never
 * want to spin retrying an error that will never clear.
 */
const SAHPOOL_INSTALL_TOTAL_BUDGET_MS = 3_000;
const SAHPOOL_INSTALL_INITIAL_DELAY_MS = 150;
const SAHPOOL_INSTALL_MAX_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether an install failure is the transient "the previous worker still holds
 * the OPFS access handles" race (vs. a permanent, fail-fast failure).
 *
 * The browser surfaces it as a DOMException named `NoModificationAllowedError`;
 * we also match the message text because the SAHPool installer may rethrow it as
 * a plain `Error` (losing the name) while preserving the message. Matching both
 * keeps this robust to how the error is wrapped without retrying unrelated
 * failures.
 */
export function isAccessHandleContentionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = Reflect.get(error, "name");
  if (name === "NoModificationAllowedError") {
    return true;
  }

  const message = Reflect.get(error, "message");
  return (
    typeof message === "string" &&
    message.includes("Access Handles cannot be created")
  );
}

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
 * Installs the SAHPool VFS, retrying while a previous worker still holds its OPFS
 * access handles (see the retry-constant comment), bounded by a wall-clock budget
 * with capped exponential backoff.
 *
 * Only the lock-contention race is retried; every other failure (no OPFS,
 * missing wasm) propagates on the first attempt so persistence fails fast.
 *
 * `overrides` exists purely so tests can shrink the budget/delays (production
 * intentionally waits several seconds of real time); production callers pass
 * nothing and get the module constants. `now` is injectable for the same reason.
 */
export async function installSahPoolVfsWithRetry(
  s: Sqlite3Static,
  overrides?: {
    totalBudgetMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    now?: () => number;
  },
): Promise<SAHPoolUtil> {
  const totalBudgetMs =
    overrides?.totalBudgetMs ?? SAHPOOL_INSTALL_TOTAL_BUDGET_MS;
  const maxDelayMs = overrides?.maxDelayMs ?? SAHPOOL_INSTALL_MAX_DELAY_MS;
  const now = overrides?.now ?? (() => Date.now());

  const startedAt = now();
  let nextDelayMs =
    overrides?.initialDelayMs ?? SAHPOOL_INSTALL_INITIAL_DELAY_MS;

  for (;;) {
    try {
      return await s.installOpfsSAHPoolVfs({
        name: SAHPOOL_VFS_NAME,
        directory: SAHPOOL_DIRECTORY,
        // Preserve existing files across sessions — this is the whole point.
        clearOnInit: false,
      });
    } catch (error: unknown) {
      // A non-contention failure will never clear by waiting — rethrow now so the
      // app reaches its boot-error state immediately instead of after the budget.
      if (!isAccessHandleContentionError(error)) {
        throw error;
      }
      // Give up once the next backoff would exceed the total budget, so we always
      // surface the (real, persistent-looking) error rather than retry forever.
      if (now() - startedAt + nextDelayMs > totalBudgetMs) {
        throw error;
      }
      // The previous worker's handles release some time after its page is
      // discarded; back off (capped) and try to re-acquire them.
      await delay(nextDelayMs);
      nextDelayMs = Math.min(nextDelayMs * 2, maxDelayMs);
    }
  }
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
      const poolUtil = await installSahPoolVfsWithRetry(s);
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

/**
 * Gracefully tear down a database and, for the persistent backend, release the
 * SAHPool VFS's OPFS access handles so the *next* worker (a reload, or another
 * tab) can acquire them without losing the lock-contention race.
 *
 * `Worker.terminate()` alone is not enough: it kills the worker abruptly and the
 * browser only releases its OPFS handles asynchronously afterwards, which is the
 * exact window that makes a reloaded page's SAHPool install fail. Calling this
 * *before* termination closes the db and `pauseVfs()`es the pool — `pauseVfs`
 * "unregister[s] this VFS and release[s] file access handles, without clearing
 * files" — so the handles are free the moment the next worker boots.
 *
 * Best-effort and never throws: teardown runs on a path where the worker is
 * going away regardless, so a cleanup failure must not become an unhandled
 * rejection. The pool's files are durable in OPFS, so a missed pause only risks
 * one transient contention retry next boot, which `installSahPoolVfsWithRetry`
 * already absorbs.
 */
export async function closeDatabase(
  db: InstanceType<Sqlite3Static["oo1"]["DB"]> | null,
): Promise<void> {
  try {
    db?.close();
  } catch {
    // The db may already be closed or in a bad state; ignore — we are tearing
    // down regardless.
  }

  // Release the OPFS access handles. The db must be closed first (done above),
  // which is why pausing lives here rather than alongside the install. The
  // singleton is cleared so a subsequent init in the same worker re-installs
  // (e.g. switching identity databases) instead of reusing a paused pool.
  const vfs = persistentVfs;
  if (!vfs) {
    return;
  }
  persistentVfs = undefined;
  persistentVfsPromise = undefined;
  try {
    vfs.poolUtil.pauseVfs();
  } catch {
    // If pausing fails the handles are released when the worker is terminated;
    // the next boot just falls back to the contention retry. Swallow so this
    // stays a no-throw best-effort teardown.
  }
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
