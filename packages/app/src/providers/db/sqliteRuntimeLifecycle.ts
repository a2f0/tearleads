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
const SQLITE_RUNTIME_RELEASE_TIMEOUT_MS = 1_000;

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
  } = params;

  if (runtimeRef.current || bootingRef.current) {
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

    void bootSQLiteRuntime(
      runtime,
      nextDbName,
      persistence,
      resolveCipherKey,
      log,
    )
      .then(() => {
        completeSQLiteRuntimeBoot({
          runtime,
          runtimeRef,
          bootingRef,
          tearleads,
          dbName: nextDbName,
          log,
        });
        // The boot resolved without throwing, so clear any transient-failure
        // budget accrued for this db name before its next race.
        onBootSucceeded?.(nextDbName);
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
            }); wiping and recreating ${nextDbName}.`,
          );
          onUnreadableDatabase(nextDbName);
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
          onTransientBootFailure(nextDbName)
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
      });
  } catch (error) {
    bootingRef.current = false;
    console.error("Failed to create database worker:", error);
    tearleads.database.clear("error");
  }
}
