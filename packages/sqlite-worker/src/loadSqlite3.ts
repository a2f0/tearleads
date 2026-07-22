import type { Sqlite3Static } from "@tearleads/sqlite-instance";
import { runWithBunFetchLock } from "./bunFetchLock";
import {
  SAHPOOL_STEP_HANG_TIMEOUT_MS,
  SahPoolStepTimeoutError,
  withSahPoolStepHangTimeout,
} from "./sahPoolHangTimeout";
import { loadSqlite3WithFilteredWarnings } from "./sqliteBootstrapWarnings";
import type {
  DatabasePersistenceMode,
  DatabaseWorkerInitOptions,
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
 * OPFS directory root and registered VFS name prefix for persistent SAHPools.
 * The final directory/name are derived from the SQLite database name so separate
 * pane databases can be opened by separate workers without contending on the
 * same SAHPool access-handle files. Keep the derivation stable: changing it
 * changes where persisted bytes live.
 */
const SAHPOOL_VFS_NAME_PREFIX = "tearleads-opfs-sahpool";
const SAHPOOL_DIRECTORY_ROOT = "/tearleads-sqlite";

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
const persistentVfsPromisesByStorageKey = new Map<
  string,
  Promise<PersistentVfs>
>();
const storageKeyByDb = new WeakMap<object, string>();

function sahPoolStorageSegmentForDbName(dbName: string): string {
  const segment = dbName
    .trim()
    .replace(/^\/+/u, "")
    // Preserve dots so `a.b` and `a_b` do not collapse to the same SAHPool.
    .replace(/[^a-zA-Z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  // A literal "." or ".." could be interpreted as navigation relative to the
  // SAHPool root; keep those reserved names mapped to a regular child segment.
  return !segment || segment === "." || segment === ".." ? "default" : segment;
}

export function persistentSahPoolStorageForDbName(dbName: string): {
  directory: string;
  vfsName: string;
} {
  const segment = sahPoolStorageSegmentForDbName(dbName);
  return {
    directory: `${SAHPOOL_DIRECTORY_ROOT}/${segment}`,
    vfsName: `${SAHPOOL_VFS_NAME_PREFIX}-${segment}`,
  };
}

function persistentVfsStorageKey(storage: {
  directory: string;
  vfsName: string;
}): string {
  return `${storage.vfsName}\n${storage.directory}`;
}

export async function loadSqlite3(): Promise<Sqlite3Static> {
  if (sqlite3) {
    return sqlite3;
  }

  if (!sqlite3Promise) {
    sqlite3Promise = runWithBunFetchLock(async () => {
      const instance = await loadSqlite3WithFilteredWarnings();
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
    directory?: string;
    totalBudgetMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    stepHangTimeoutMs?: number;
    now?: () => number;
    vfsName?: string;
  },
): Promise<SAHPoolUtil> {
  const directory = overrides?.directory ?? SAHPOOL_DIRECTORY_ROOT;
  const vfsName = overrides?.vfsName ?? SAHPOOL_VFS_NAME_PREFIX;
  const totalBudgetMs =
    overrides?.totalBudgetMs ?? SAHPOOL_INSTALL_TOTAL_BUDGET_MS;
  const maxDelayMs = overrides?.maxDelayMs ?? SAHPOOL_INSTALL_MAX_DELAY_MS;
  const stepHangTimeoutMs =
    overrides?.stepHangTimeoutMs ?? SAHPOOL_STEP_HANG_TIMEOUT_MS;
  const now = overrides?.now ?? (() => Date.now());

  const startedAt = now();
  let nextDelayMs =
    overrides?.initialDelayMs ?? SAHPOOL_INSTALL_INITIAL_DELAY_MS;

  for (;;) {
    try {
      return await withSahPoolStepHangTimeout(
        s.installOpfsSAHPoolVfs({
          name: vfsName,
          directory,
          // Preserve existing files across sessions — this is the whole point.
          clearOnInit: false,
        }),
        stepHangTimeoutMs,
      );
    } catch (error: unknown) {
      // A hung install (Android WebView can leave createSyncAccessHandle pending
      // forever under handle-cap contention) is surfaced, NOT retried in place: a
      // second concurrent install would only pile more half-acquired handles onto
      // the already-saturated origin. Surfacing it lets `initDatabase` reject
      // (instead of hanging past the app boot timeout), so the worker answers and is
      // torn down — releasing its handles — and the app re-attempts boot on a fresh
      // worker as the origin drains. See SAHPOOL_STEP_HANG_TIMEOUT_MS.
      if (error instanceof SahPoolStepTimeoutError) {
        throw error;
      }
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
 * The VFSes are registered globally in the WASM instance, so a worker reuses the
 * same VFS stack for repeated opens of the same database name. The SAHPool VFS
 * is synchronous and therefore needs neither `SharedArrayBuffer` nor
 * cross-origin isolation (COOP/COEP).
 *
 * Throws if OPFS is unavailable or the VFS stack cannot be installed —
 * persistence is a hard requirement once requested, never a silent fall back to
 * memory.
 */
async function loadPersistentVfs(
  s: Sqlite3Static,
  dbName: string,
): Promise<PersistentVfs> {
  const storage = persistentSahPoolStorageForDbName(dbName);
  const storageKey = persistentVfsStorageKey(storage);

  if (typeof s.installOpfsSAHPoolVfs !== "function") {
    throw new Error(
      "Persistent storage requested but the SQLite build does not provide installOpfsSAHPoolVfs.",
    );
  }

  const existingPromise = persistentVfsPromisesByStorageKey.get(storageKey);
  if (existingPromise) {
    return existingPromise;
  }

  // Compare failures through an entry object so an older rejected install only
  // clears the promise it created, not a newer retry installed after teardown.
  const entry: { promise?: Promise<PersistentVfs> } = {};
  entry.promise = (async () => {
    const poolUtil = await installSahPoolVfsWithRetry(s, {
      directory: storage.directory,
      vfsName: storage.vfsName,
    });
    // reserveMinimumCapacity also opens SyncAccessHandles, so it can hang under
    // the same Android handle-cap contention; bound it too so a stalled
    // reservation rejects instead of leaving the worker silent forever.
    await withSahPoolStepHangTimeout(
      poolUtil.reserveMinimumCapacity(SAHPOOL_MINIMUM_CAPACITY),
      SAHPOOL_STEP_HANG_TIMEOUT_MS,
    );
    const cipherVfsName = createCipherVfs(s, poolUtil.vfsName);
    const resolved: PersistentVfs = { poolUtil, cipherVfsName };
    return resolved;
  })().catch((error: unknown) => {
    // Allow a later attempt to retry rather than caching a rejected promise.
    if (persistentVfsPromisesByStorageKey.get(storageKey) === entry.promise) {
      persistentVfsPromisesByStorageKey.delete(storageKey);
    }
    throw error instanceof Error
      ? error
      : new Error("Failed to install the persistent SQLite VFS.", {
          cause: error,
        });
  });
  persistentVfsPromisesByStorageKey.set(storageKey, entry.promise);

  return entry.promise;
}

async function openDatabaseForMode(
  s: Sqlite3Static,
  dbName: string,
  persistence: DatabasePersistenceMode,
): Promise<InstanceType<Sqlite3Static["oo1"]["DB"]>> {
  if (persistence === "memory") {
    return new s.oo1.DB(dbName);
  }

  const { cipherVfsName } = await loadPersistentVfs(s, dbName);
  // Open against the cipher-capable wrapper VFS (not the bare SAHPool VFS) so the
  // encryption PRAGMAs below succeed. "c" = create-if-missing, read/write.
  const db = new s.oo1.DB(dbName, "c", cipherVfsName);
  const storage = persistentSahPoolStorageForDbName(dbName);
  storageKeyByDb.set(db, persistentVfsStorageKey(storage));
  return db;
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
/**
 * Shared teardown for {@link closeDatabase} and {@link deleteDatabase}: close
 * the db, drop its bookkeeping, then run `releaseVfs` against each persistent
 * pool that should be released. A specific db releases only its own pool; a
 * `null` db is the worker-level fallback that releases every installed pool.
 *
 * Best-effort and never throws — the caller terminates the worker right after,
 * so a cleanup failure must not become an unhandled rejection.
 */
async function teardownDatabase(
  db: InstanceType<Sqlite3Static["oo1"]["DB"]> | null,
  releaseVfs: (vfs: PersistentVfs) => void | Promise<void>,
): Promise<void> {
  const storageKey = db ? storageKeyByDb.get(db) : undefined;

  try {
    db?.close();
  } catch {
    // Already closed or in a bad state; we are tearing down regardless.
  }

  if (db) {
    storageKeyByDb.delete(db);
  }

  const vfsPromises = storageKey
    ? [persistentVfsPromisesByStorageKey.get(storageKey)]
    : db
      ? []
      : [...persistentVfsPromisesByStorageKey.values()];
  if (storageKey) {
    persistentVfsPromisesByStorageKey.delete(storageKey);
  } else if (!db) {
    persistentVfsPromisesByStorageKey.clear();
  }

  for (const vfsPromise of vfsPromises) {
    if (!vfsPromise) {
      continue;
    }
    try {
      await releaseVfs(await vfsPromise);
    } catch {
      // The install may have failed, or release may throw; swallow so this stays
      // a no-throw best-effort teardown. Terminating the worker releases the
      // handles regardless, and the next boot's contention retry covers the gap.
    }
  }
}

/**
 * Gracefully tear down a database, releasing (but not deleting) the SAHPool
 * VFS's OPFS access handles via `pauseVfs()` so the next worker can acquire them
 * without losing the lock-contention race. See {@link teardownDatabase}.
 */
export function closeDatabase(
  db: InstanceType<Sqlite3Static["oo1"]["DB"]> | null,
): Promise<void> {
  return teardownDatabase(db, (vfs) => {
    vfs.poolUtil.pauseVfs();
  });
}

/**
 * Permanently destroy a persistent database: close it, then `wipeFiles()` +
 * `removeVfs()` so the OPFS-backed bytes are gone (not merely released for the
 * next worker, as {@link closeDatabase} does). For an in-memory database there
 * is nothing on disk, so this is just a close.
 */
export function deleteDatabase(
  db: InstanceType<Sqlite3Static["oo1"]["DB"]> | null,
): Promise<void> {
  return teardownDatabase(db, async (vfs) => {
    await vfs.poolUtil.wipeFiles();
    await vfs.poolUtil.removeVfs();
  });
}

export { execDatabaseStatement } from "./executeStatement";
