import type { DatabaseStatus, Tearleads } from "@tearleads/client-sdk";
import type {
  DatabasePersistenceMode,
  SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import type { RefObject } from "react";
import {
  bootSQLiteRuntime,
  isBootRoundTripTimeoutError,
} from "./bootSQLiteRuntime";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";

type SQLiteRuntimeStatus = DatabaseStatus;
/**
 * How long to wait for a runtime's graceful close before force-terminating it.
 *
 * The graceful close matters on an identity switch: releasing identity 1's
 * runtime must finish before identity 2's worker opens its database. The worker
 * posts its `close` acknowledgement only *after* `pauseVfs()` → `ah.close()` has
 * released that database's OPFS SAHPool access handles (see
 * `@tearleads/sqlite-worker` closeDatabase/teardownDatabase), so awaiting the
 * close is what guarantees the per-origin handle slots are free for identity 2 —
 * and, on the cross-tab transport, that identity 1's client was cleanly removed
 * from the shared owner rather than force-stopped, which otherwise strands the
 * owner "dead but pinned" so identity 2's `init` round-trip is never answered
 * (the second-identity provisioning hang). `Worker.terminate()` alone defers
 * handle release to GC of the dead thread — the exact window that wedges the
 * next boot — so we terminate only after the close settles, or after this
 * fallback bound if the close never answers.
 *
 * Kept comfortably under the boot round-trip timeout (15s, see
 * {@link bootSQLiteRuntime}) so a genuinely wedged teardown still yields to a
 * fresh boot instead of compounding. A normal idle close acks in well under a
 * second, so this larger bound never adds latency to the common path.
 */
const SQLITE_RUNTIME_RELEASE_TIMEOUT_MS = 10_000;

/**
 * Whether a boot error is "the persisted database could not be decrypted with the
 * resolved cipher key" — i.e. SQLite result code 26 (`SQLITE_NOTADB`, "file is
 * not a database"). On an encrypted OPFS database this means a key/keyring desync
 * (e.g. the keyring's localStorage manifest was evicted while the OPFS db file
 * survived, so a fresh root was minted): the on-disk ciphertext can never be
 * recovered with the current key. We treat it as a signal to wipe and recreate
 * rather than a permanent boot failure.
 */
function isUnreadableDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("SQLITE_NOTADB") ||
    message.includes("file is not a database") ||
    /result code 26\b/.test(message)
  );
}

export function releaseSQLiteRuntime(runtime: SQLiteRuntime): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      try {
        runtime.terminateNow();
      } finally {
        resolve();
      }
    };

    timeoutId = setTimeout(finish, SQLITE_RUNTIME_RELEASE_TIMEOUT_MS);
    try {
      runtime.client.close().then(finish, finish);
    } catch {
      finish();
    }
  });
}

function configureSdkSQLiteRuntime(
  tearleads: Tearleads,
  runtime: SQLiteRuntime,
  status?: SQLiteRuntimeStatus,
) {
  tearleads.database.configure({
    client: runtime.client,
    id: runtime.id,
    status,
  });
}

function completeSQLiteRuntimeBoot(params: {
  runtime: SQLiteRuntime;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  dbName: string;
  log: (message: string) => void;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, dbName, log } = params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  configureSdkSQLiteRuntime(tearleads, runtime);
  log(`Database initialized successfully: ${dbName}`);
  log("Worker spawned");
}

function failSQLiteRuntimeBoot(params: {
  runtime: SQLiteRuntime;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  error: unknown;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, error } = params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  console.error("Failed to initialize database worker:", error);
  configureSdkSQLiteRuntime(tearleads, runtime, "error");
}

interface StartSQLiteRuntimeBootParams {
  bootingRef: RefObject<boolean>;
  createSQLiteRuntime: () => SQLiteRuntime;
  currentDbNameRef: RefObject<string | null>;
  killedRef: RefObject<boolean>;
  log: (message: string) => void;
  nextDbName: string;
  /**
   * Invoked when a *persistent* database fails to boot because its on-disk bytes
   * cannot be decrypted with the resolved key (see {@link isUnreadableDatabaseError}).
   * The handler owns the resulting status (it wipes + recreates), so this boot
   * does not flip to "error". Omitted for in-memory runtimes (never key-mismatched).
   */
  onUnreadableDatabase?: (dbName: string) => void;
  /**
   * Invoked when a boot round-trip never answered (a teardown/respawn race, see
   * {@link isBootRoundTripTimeoutError}) rather than a real init failure. Tears
   * the stuck worker down and re-spawns a fresh one; returns `true` when it did
   * (this boot is handled) and `false` once the re-spawn budget is exhausted, in
   * which case the boot flips to "error" through the normal path.
   */
  onTransientBootFailure?: (dbName: string) => boolean;
  /** Invoked when the boot succeeds, so recovery can reset its re-spawn budget. */
  onBootSucceeded?: (dbName: string) => void;
  persistence: DatabasePersistenceMode;
  resolveCipherKey: ResolveSqliteCipherKey;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
  /**
   * Reuse an already-running worker for a database-name change instead of
   * tearing it down and constructing a new one. When a live runtime exists and
   * its database differs from `nextDbName`, close the current database (which
   * releases its OPFS SAHPool handles inside the worker) and re-init the SAME
   * worker onto the new database. Only safe for a dedicated worker: a cross-tab
   * client's `close` stops the shared owner, so this must stay off there. Native
   * WebView shells set it because constructing a *second* worker fails on a
   * WebView (a cross-tab owner re-election never answers `init`; a fresh
   * dedicated module Worker errors on construction) — the second-identity
   * provisioning hang.
   */
  reuseWorker?: boolean;
}

// Wires a boot promise (a fresh runtime's boot, or a reused runtime's
// close+re-init) to the shared completion/recovery handling.
function settleSQLiteRuntimeBoot(params: {
  bootPromise: Promise<void>;
  runtime: SQLiteRuntime;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  currentDbNameRef: RefObject<string | null>;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
  dbName: string;
  persistence: DatabasePersistenceMode;
  log: (message: string) => void;
  onUnreadableDatabase?: ((dbName: string) => void) | undefined;
  onTransientBootFailure?: ((dbName: string) => boolean) | undefined;
  onBootSucceeded?: ((dbName: string) => void) | undefined;
  // Re-run a boot for `dbName` on the reused worker. Called after this boot
  // settles if the target changed while it was in flight (see below).
  rebootForDbName: (dbName: string) => void;
}) {
  const {
    bootPromise,
    runtime,
    runtimeRef,
    bootingRef,
    targetDbNameRef,
    tearleads,
    dbName,
    persistence,
    log,
    onUnreadableDatabase,
    onTransientBootFailure,
    onBootSucceeded,
    rebootForDbName,
  } = params;

  bootPromise
    .then(() => {
      completeSQLiteRuntimeBoot({
        runtime,
        runtimeRef,
        bootingRef,
        tearleads,
        dbName,
        log,
      });
      // The boot resolved without throwing, so clear any transient-failure
      // budget accrued for this db name before its next race.
      onBootSucceeded?.(dbName);
      // An identity transition can start while this boot is still in flight; its
      // spawn no-ops because bootingRef is set. If the target moved on while we
      // booted `dbName`, boot the worker onto that target now that it is free —
      // otherwise the waiting ensureReady would hang, since this completion names
      // the wrong database. Guarded on the runtime still being current (a reused,
      // not torn-down, worker) so a superseded boot never re-drives it.
      if (
        runtimeRef.current === runtime &&
        targetDbNameRef.current !== dbName
      ) {
        rebootForDbName(targetDbNameRef.current);
      }
    })
    .catch((error) => {
      // A persisted db that cannot be decrypted with the resolved key is not a
      // retryable boot flake — the ciphertext is unrecoverable without the lost
      // key. Hand off to recovery (wipe + recreate once), which owns the status,
      // instead of flipping to "error" (which would flash an error in the UI and
      // strand the user on an unreadable database forever).
      if (
        runtimeRef.current === runtime &&
        persistence !== "memory" &&
        onUnreadableDatabase &&
        isUnreadableDatabaseError(error)
      ) {
        bootingRef.current = false;
        log(
          `Database is unreadable with the resolved cipher key (${
            error instanceof Error ? error.message : String(error)
          }); wiping and recreating ${dbName}.`,
        );
        onUnreadableDatabase(dbName);
        return;
      }

      // A boot round-trip that never answered is the teardown/respawn race, not
      // a real init failure. Hand off to recovery (tear the stuck worker down +
      // re-spawn, bounded) instead of flipping to "error" and stranding the app
      // keyless. Once the budget is exhausted the handler returns false and we
      // fall through to the normal error path — which, unlike the recovery's own
      // teardown, keeps the db name set so a waiting ensureIdentityReady rejects.
      if (
        runtimeRef.current === runtime &&
        onTransientBootFailure &&
        isBootRoundTripTimeoutError(error) &&
        onTransientBootFailure(dbName)
      ) {
        bootingRef.current = false;
        return;
      }

      failSQLiteRuntimeBoot({
        runtime,
        runtimeRef,
        bootingRef,
        tearleads,
        error,
      });

      // Same superseded-target race as the success branch: a transition may have
      // moved the target off this (now failed) database while it booted. Its
      // spawn no-op'd on bootingRef, and this terminal "error" names the OLD
      // database, so the waiting ensureReady — gated on the target name — would
      // ignore it and hang. Boot the still-current reused worker onto the pending
      // target instead. (A pre-init failure such as a cipher-key timeout leaves
      // the worker healthy; a genuinely wedged one is caught by the next boot's
      // round-trip timeout + recovery.)
      if (
        runtimeRef.current === runtime &&
        targetDbNameRef.current !== dbName
      ) {
        rebootForDbName(targetDbNameRef.current);
      }
    });
}

// Bound the outgoing database's graceful close when a worker is reused. The
// close releases that database's OPFS handles inside the worker, but a wedged
// worker can leave close() unanswered; without a bound the reuse chain would
// never reach bootSQLiteRuntime — whose own round-trip timeouts and transient
// recovery heal a wedged worker — so bootingRef would stay true and the identity
// switch would hang. Race the close against this timeout and proceed regardless:
// a normal close acks in well under a second, and a hung one falls through to the
// boot timeout. Kept under the boot round-trip timeout for the same reason
// SQLITE_RUNTIME_RELEASE_TIMEOUT_MS is.
const SQLITE_RUNTIME_REUSE_CLOSE_TIMEOUT_MS = 5_000;

function closeReusedRuntimeDatabase(runtime: SQLiteRuntime): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve();
    };

    timeoutId = setTimeout(finish, SQLITE_RUNTIME_REUSE_CLOSE_TIMEOUT_MS);
    try {
      runtime.client.close().then(finish, finish);
    } catch {
      finish();
    }
  });
}

// Reuse a live worker for a database switch: close its current database (which
// releases that database's OPFS handles inside the worker) then re-init the SAME
// worker onto the new database, instead of tearing the worker down and building a
// new one (which fails on a WebView — the second-identity provisioning hang).
function reuseSQLiteRuntimeForDbName(
  params: StartSQLiteRuntimeBootParams,
  existingRuntime: SQLiteRuntime,
) {
  const {
    bootingRef,
    currentDbNameRef,
    killedRef,
    log,
    nextDbName,
    onUnreadableDatabase,
    onTransientBootFailure,
    onBootSucceeded,
    persistence,
    resolveCipherKey,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  } = params;

  killedRef.current = false;
  bootingRef.current = true;
  targetDbNameRef.current = nextDbName;
  currentDbNameRef.current = nextDbName;
  // Not-ready while the worker swaps databases so a waiter never mistakes the
  // outgoing database's "ready" for the incoming one.
  configureSdkSQLiteRuntime(tearleads, existingRuntime, "idle");

  // Close (bounded, best-effort) releases the outgoing database's OPFS handles;
  // then repurpose the SAME worker for the new database with a FRESH client. The
  // SDK keys per-connection caches — schema/projection ensures, mutation queues,
  // persistence runtimes — off the client object, so without a fresh client the
  // new database would inherit the previous one's "schema already ensured" state
  // and its tables would never be created, and the first query or write would hit
  // "no such table". renewClient swaps in a fresh client/id on the same worker.
  const bootPromise = closeReusedRuntimeDatabase(existingRuntime)
    .then(() => {
      existingRuntime.renewClient?.();
    })
    .then(() =>
      bootSQLiteRuntime(
        existingRuntime,
        nextDbName,
        persistence,
        resolveCipherKey,
        log,
      ),
    );

  settleSQLiteRuntimeBoot({
    bootPromise,
    runtime: existingRuntime,
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    targetDbNameRef,
    tearleads,
    dbName: nextDbName,
    persistence,
    log,
    onUnreadableDatabase,
    onTransientBootFailure,
    onBootSucceeded,
    rebootForDbName: (next) =>
      startSQLiteRuntimeBoot({ ...params, nextDbName: next }),
  });
}

export function startSQLiteRuntimeBoot(params: StartSQLiteRuntimeBootParams) {
  const {
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    killedRef,
    log,
    nextDbName,
    onUnreadableDatabase,
    onTransientBootFailure,
    onBootSucceeded,
    persistence,
    resolveCipherKey,
    runtimeRef,
    targetDbNameRef,
    tearleads,
    reuseWorker,
  } = params;

  if (bootingRef.current) {
    return;
  }

  const existingRuntime = runtimeRef.current;
  if (existingRuntime) {
    // A live worker exists. Reuse it for a database switch when the host opts in
    // (dedicated worker); otherwise leave it to the caller's teardown path.
    if (reuseWorker && currentDbNameRef.current !== nextDbName) {
      reuseSQLiteRuntimeForDbName(params, existingRuntime);
    }
    return;
  }

  killedRef.current = false;
  bootingRef.current = true;
  targetDbNameRef.current = nextDbName;
  currentDbNameRef.current = nextDbName;

  try {
    const runtime = createSQLiteRuntime();
    runtimeRef.current = runtime;
    configureSdkSQLiteRuntime(tearleads, runtime, "idle");

    settleSQLiteRuntimeBoot({
      bootPromise: bootSQLiteRuntime(
        runtime,
        nextDbName,
        persistence,
        resolveCipherKey,
        log,
      ),
      runtime,
      runtimeRef,
      bootingRef,
      currentDbNameRef,
      targetDbNameRef,
      tearleads,
      dbName: nextDbName,
      persistence,
      log,
      onUnreadableDatabase,
      onTransientBootFailure,
      onBootSucceeded,
      rebootForDbName: (next) =>
        startSQLiteRuntimeBoot({ ...params, nextDbName: next }),
    });
  } catch (error) {
    bootingRef.current = false;
    console.error("Failed to create database worker:", error);
    tearleads.database.clear("error");
  }
}
