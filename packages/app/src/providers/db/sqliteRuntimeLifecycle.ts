import type { DatabaseStatus, Tearleads } from "@tearleads/client-sdk";
import type {
  DatabasePersistenceMode,
  SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import type { RefObject } from "react";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import {
  bootSQLiteRuntime,
  isBootRoundTripTimeoutError,
} from "./bootSQLiteRuntime";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";
import {
  canReuseSQLiteRuntime,
  logSQLiteRuntimeReuseUnavailable,
  type ReusableSQLiteRuntime,
  renewReusableSQLiteRuntime,
  resetReusableSQLiteRuntimeDatabase,
  SQLiteRuntimeResetError,
} from "./sqliteRuntimeRetention";

type SQLiteRuntimeStatus = DatabaseStatus;

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
  const message = unknownErrorMessage(error);
  return (
    message.includes("SQLITE_NOTADB") ||
    message.includes("file is not a database") ||
    /result code 26\b/.test(message)
  );
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
  tearleads.database.clear("error");
}

interface StartSQLiteRuntimeBootParams {
  bootGenerationRef: RefObject<number>;
  bootingRef: RefObject<boolean>;
  createSQLiteRuntime: () => SQLiteRuntime;
  currentDbNameRef: RefObject<string | null>;
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
interface SettleSQLiteRuntimeBootParams {
  bootGeneration: number;
  bootGenerationRef: RefObject<number>;
  bootPromise: Promise<void>;
  runtime: SQLiteRuntime;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
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
}

function isCurrentSQLiteRuntimeBoot(
  params: SettleSQLiteRuntimeBootParams,
): boolean {
  return (
    params.runtimeRef.current === params.runtime &&
    params.bootGenerationRef.current === params.bootGeneration
  );
}

function handleSQLiteRuntimeBootFailure(
  params: SettleSQLiteRuntimeBootParams,
  error: unknown,
): void {
  if (!isCurrentSQLiteRuntimeBoot(params)) {
    return;
  }

  if (error instanceof SQLiteRuntimeResetError) {
    params.runtimeRef.current = null;
    params.bootingRef.current = false;
    console.error("Failed to reset reusable database worker:", error);
    if (params.targetDbNameRef.current !== params.dbName) {
      params.tearleads.database.clear("idle");
      params.rebootForDbName(params.targetDbNameRef.current);
    } else {
      params.tearleads.database.clear("error");
    }
    return;
  }

  if (params.targetDbNameRef.current !== params.dbName) {
    params.bootingRef.current = false;
    params.tearleads.database.clear("idle");
    params.rebootForDbName(params.targetDbNameRef.current);
    return;
  }

  if (
    params.persistence !== "memory" &&
    params.onUnreadableDatabase &&
    isUnreadableDatabaseError(error)
  ) {
    params.bootingRef.current = false;
    params.log(
      `Database is unreadable with the resolved cipher key (${unknownErrorMessage(
        error,
      )}); wiping and recreating ${params.dbName}.`,
    );
    params.onUnreadableDatabase(params.dbName);
    return;
  }

  if (
    params.onTransientBootFailure &&
    isBootRoundTripTimeoutError(error) &&
    params.onTransientBootFailure(params.dbName)
  ) {
    params.bootingRef.current = false;
    return;
  }

  failSQLiteRuntimeBoot({
    runtime: params.runtime,
    runtimeRef: params.runtimeRef,
    bootingRef: params.bootingRef,
    tearleads: params.tearleads,
    error,
  });
}

function settleSQLiteRuntimeBoot(params: SettleSQLiteRuntimeBootParams) {
  const {
    bootPromise,
    runtime,
    runtimeRef,
    bootingRef,
    targetDbNameRef,
    tearleads,
    dbName,
    log,
    onBootSucceeded,
    rebootForDbName,
  } = params;

  bootPromise
    .then(() => {
      if (!isCurrentSQLiteRuntimeBoot(params)) {
        return;
      }

      onBootSucceeded?.(dbName);
      if (targetDbNameRef.current !== dbName) {
        bootingRef.current = false;
        tearleads.database.clear("idle");
        rebootForDbName(targetDbNameRef.current);
        return;
      }

      completeSQLiteRuntimeBoot({
        runtime,
        runtimeRef,
        bootingRef,
        tearleads,
        dbName,
        log,
      });
    })
    .catch((error) => handleSQLiteRuntimeBootFailure(params, error));
}

function startFreshSQLiteRuntimeBoot(params: StartSQLiteRuntimeBootParams) {
  const {
    bootGenerationRef,
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
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

  bootingRef.current = true;
  targetDbNameRef.current = nextDbName;
  currentDbNameRef.current = nextDbName;

  try {
    const runtime = createSQLiteRuntime();
    runtimeRef.current = runtime;
    tearleads.database.clear("idle");

    settleSQLiteRuntimeBoot({
      bootGeneration: bootGenerationRef.current,
      bootGenerationRef,
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

// Boot a retained worker onto a database. An identity switch closes the outgoing
// database first; an explicit clear has already closed it and renewed the client,
// so that path can boot the fresh connection directly.
function bootReusableSQLiteRuntimeForDbName(
  params: StartSQLiteRuntimeBootParams,
  existingRuntime: ReusableSQLiteRuntime,
  resetDatabase: boolean,
) {
  const {
    bootGenerationRef,
    bootingRef,
    currentDbNameRef,
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

  bootingRef.current = true;
  targetDbNameRef.current = nextDbName;
  currentDbNameRef.current = nextDbName;
  // Detach the outgoing client while retaining the worker privately for reuse.
  tearleads.database.clear("idle");

  const bootPromise = (async () => {
    if (resetDatabase) {
      // Never proceed after a rejected or timed-out close: that could leave the
      // decrypted outgoing database open beside the replacement connection.
      await resetReusableSQLiteRuntimeDatabase(existingRuntime, "close");
      if (runtimeRef.current !== existingRuntime) {
        return;
      }
      renewReusableSQLiteRuntime(existingRuntime);
    }
    if (runtimeRef.current !== existingRuntime) {
      return;
    }
    await bootSQLiteRuntime(
      existingRuntime,
      nextDbName,
      persistence,
      resolveCipherKey,
      log,
    );
  })();

  settleSQLiteRuntimeBoot({
    bootGeneration: bootGenerationRef.current,
    bootGenerationRef,
    bootPromise,
    runtime: existingRuntime,
    runtimeRef,
    bootingRef,
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
    bootGenerationRef,
    bootingRef,
    currentDbNameRef,
    log,
    nextDbName,
    runtimeRef,
    tearleads,
    reuseWorker,
  } = params;

  if (bootingRef.current) {
    return;
  }

  bootGenerationRef.current += 1;

  const existingRuntime = runtimeRef.current;
  if (existingRuntime) {
    // If the SDK was detached without resetting a runtime that still owns this
    // database, reattach it instead of waiting for an unnecessary boot.
    if (currentDbNameRef.current === nextDbName) {
      if (
        !bootingRef.current &&
        (tearleads.database.status !== "ready" ||
          tearleads.database.client !== existingRuntime.client)
      ) {
        configureSdkSQLiteRuntime(tearleads, existingRuntime);
      }
      return;
    }

    if (canReuseSQLiteRuntime(Boolean(reuseWorker), existingRuntime)) {
      bootReusableSQLiteRuntimeForDbName(
        params,
        existingRuntime,
        currentDbNameRef.current !== null,
      );
      return;
    }

    if (reuseWorker) {
      logSQLiteRuntimeReuseUnavailable(true, existingRuntime, log);
      existingRuntime.terminateNow();
      runtimeRef.current = null;
      currentDbNameRef.current = null;
      tearleads.database.clear("idle");
      startSQLiteRuntimeBoot(params);
    }
    return;
  }

  startFreshSQLiteRuntimeBoot(params);
}
