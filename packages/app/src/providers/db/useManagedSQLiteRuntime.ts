import type {
  DatabaseSnapshot,
  DatabaseStatus,
  Tearleads,
} from "@tearleads/client-sdk";
import type {
  DatabasePersistenceMode,
  SQLiteRuntime,
  StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";
import { startSQLiteRuntimeBoot } from "./sqliteRuntimeLifecycle";
import type { SQLiteRuntimeOperation } from "./sqliteRuntimeOperation";
import {
  canReuseSQLiteRuntime,
  logSQLiteRuntimeReuseUnavailable,
} from "./sqliteRuntimeRetention";
import { useReleaseRuntimeOnPageHide } from "./useReleaseRuntimeOnPageHide";
import { useSQLiteRuntimeActions } from "./useSQLiteRuntimeActions";
import { useSQLiteRuntimeControls } from "./useSQLiteRuntimeControls";
import { useTransientBootFailureRecovery } from "./useTransientBootFailureRecovery";
import { useUnreadableDatabaseRecovery } from "./useUnreadableDatabaseRecovery";

type SQLiteRuntimeStatus = DatabaseStatus;

export interface DatabaseContextValue {
  id: string | null;
  client: DatabaseSnapshot["client"];
  status: SQLiteRuntimeStatus;
  /**
   * Clear the current database (→ idle). A reusable host closes it and renews
   * the connection while retaining the physical worker; other hosts terminate.
   */
  clearWorker: () => void;
  /**
   * Close the database for an identity transition while retaining a reusable
   * physical worker when the host supports it.
   */
  clearWorkerForIdentitySwitch: () => void;
  ensureIdentityReady: (signingFingerprint: string) => Promise<void>;
  ensureReady: () => Promise<void>;
  killWorker: () => void;
  /**
   * Wipe the persisted database. Reusable hosts renew the connection afterward;
   * other hosts terminate the worker.
   */
  purgeWorker: () => Promise<void>;
  /** Wipe only this fingerprint's database, including when it is not open. */
  purgeIdentityDatabase: (signingFingerprint: string) => Promise<void>;
  spawnWorker: () => void;
}

function useSQLiteRuntimeLifecycle(
  dbName: string,
  targetDbNameRef: RefObject<string>,
  currentDbNameRef: RefObject<string | null>,
  runtimeRef: RefObject<SQLiteRuntime | null>,
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void,
  log: (message: string) => void,
  reuseWorker: boolean,
) {
  useEffect(() => {
    targetDbNameRef.current = dbName;
    if (
      !canReuseSQLiteRuntime(reuseWorker, runtimeRef.current) &&
      currentDbNameRef.current &&
      currentDbNameRef.current !== dbName
    ) {
      logSQLiteRuntimeReuseUnavailable(reuseWorker, runtimeRef.current, log);
      destroyCurrentRuntime("idle");
    }
  }, [
    currentDbNameRef,
    dbName,
    destroyCurrentRuntime,
    log,
    reuseWorker,
    runtimeRef,
    targetDbNameRef,
  ]);

  useEffect(() => {
    return () => {
      destroyCurrentRuntime("idle");
    };
  }, [destroyCurrentRuntime]);
}

interface SpawnSQLiteRuntimeParams {
  bootGenerationRef: RefObject<number>;
  bootingRef: RefObject<boolean>;
  createSQLiteRuntime: () => SQLiteRuntime;
  currentDbNameRef: RefObject<string | null>;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  onWorkerCrash: (error: Error) => void;
  onUnreadableDatabase: (dbName: string) => void;
  onTransientBootFailure: (dbName: string) => boolean;
  onBootSucceeded: (dbName: string) => void;
  persistence: DatabasePersistenceMode;
  resolveCipherKey: ResolveSqliteCipherKey;
  reuseWorker: boolean;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}

// The boot itself; callers gate on mount and pending operations first.
function useSpawnSQLiteRuntime(params: SpawnSQLiteRuntimeParams) {
  const {
    bootGenerationRef,
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    log,
    logError,
    onWorkerCrash,
    onUnreadableDatabase,
    onTransientBootFailure,
    onBootSucceeded,
    persistence,
    resolveCipherKey,
    reuseWorker,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  } = params;

  return useCallback(
    (nextDbName: string) => {
      startSQLiteRuntimeBoot({
        bootGenerationRef,
        bootingRef,
        createSQLiteRuntime,
        currentDbNameRef,
        log,
        logError,
        nextDbName,
        onWorkerCrash,
        onUnreadableDatabase,
        onTransientBootFailure,
        onBootSucceeded,
        persistence,
        resolveCipherKey,
        reuseWorker,
        runtimeRef,
        targetDbNameRef,
        tearleads,
      });
    },
    [
      bootGenerationRef,
      bootingRef,
      createSQLiteRuntime,
      currentDbNameRef,
      log,
      logError,
      onWorkerCrash,
      onUnreadableDatabase,
      onTransientBootFailure,
      onBootSucceeded,
      persistence,
      resolveCipherKey,
      reuseWorker,
      runtimeRef,
      targetDbNameRef,
      tearleads,
    ],
  );
}

function useSpawnSQLiteRuntimeForDbName(
  params: SpawnSQLiteRuntimeParams & {
    runtimeOperationRef: RefObject<SQLiteRuntimeOperation | null>;
  },
) {
  const { bootingRef, runtimeOperationRef, targetDbNameRef } = params;
  const spawnRuntime = useSpawnSQLiteRuntime(params);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback(
    (nextDbName: string) => {
      if (!mountedRef.current) {
        return;
      }

      targetDbNameRef.current = nextDbName;
      const spawnAfterOperation = () => {
        const pendingOperation = runtimeOperationRef.current?.promise ?? null;
        if (pendingOperation) {
          void pendingOperation.then(spawnAfterOperation);
          return;
        }
        if (
          mountedRef.current &&
          targetDbNameRef.current === nextDbName &&
          !bootingRef.current
        ) {
          spawnRuntime(nextDbName);
        }
      };
      spawnAfterOperation();
    },
    [bootingRef, runtimeOperationRef, spawnRuntime, targetDbNameRef],
  );
}

// A crashed worker answers nothing: report it once (its callers already saw
// the rejection as the database going away) and retire the runtime so
// `waitForReadySQLiteRuntime` rejects and the retry surface appears.
function useWorkerCrashRecovery(params: {
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  logError: (message: string | Error, cause?: unknown) => void;
}): (error: Error) => void {
  const { destroyCurrentRuntime, logError } = params;
  return useCallback(
    (error: Error) => {
      logError("Database worker crashed; surfacing error", error);
      destroyCurrentRuntime("error");
    },
    [destroyCurrentRuntime, logError],
  );
}

// The boot's recovery handlers, keyed as the spawn params expect them.
function useSQLiteRuntimeRecovery(params: {
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  purgeCurrentRuntime: () => Promise<void>;
  spawnRuntimeForDbName: RefObject<(dbName: string) => void>;
}) {
  const {
    destroyCurrentRuntime,
    log,
    logError,
    purgeCurrentRuntime,
    spawnRuntimeForDbName,
  } = params;
  const onUnreadableDatabase = useUnreadableDatabaseRecovery({
    destroyCurrentRuntime,
    logError,
    purgeCurrentRuntime,
    spawnRuntimeForDbName,
  });
  const onWorkerCrash = useWorkerCrashRecovery({
    destroyCurrentRuntime,
    logError,
  });
  const { clearBudget: onBootSucceeded, recoverFromBootTimeout } =
    useTransientBootFailureRecovery({
      destroyCurrentRuntime,
      log,
      spawnRuntimeForDbName,
    });

  return useMemo(
    () => ({
      onBootSucceeded,
      onTransientBootFailure: recoverFromBootTimeout,
      onUnreadableDatabase,
      onWorkerCrash,
    }),
    [
      onBootSucceeded,
      recoverFromBootTimeout,
      onUnreadableDatabase,
      onWorkerCrash,
    ],
  );
}

export function useManagedSQLiteRuntime(
  createSQLiteRuntime: () => SQLiteRuntime,
  dbName: string,
  persistencePolicy: StoragePersistencePolicy,
  resolveCipherKey: ResolveSqliteCipherKey,
  log: (message: string) => void,
  logError: (message: string | Error, cause?: unknown) => void,
  tearleads: Tearleads,
  reuseWorker = false,
): DatabaseContextValue {
  const snapshot = useTearleadsStoreSnapshot(tearleads.database);
  const runtimeRef = useRef<SQLiteRuntime | null>(null);
  const bootGenerationRef = useRef(0);
  const bootingRef = useRef(false);
  const targetDbNameRef = useRef(dbName);
  const currentDbNameRef = useRef<string | null>(null);
  const runtimeOperationRef = useRef<SQLiteRuntimeOperation | null>(null);
  // Indirection breaks the cycle between spawn and its recovery handlers.
  const spawnRuntimeRef = useRef<(dbName: string) => void>(() => {});
  const { clearCurrentRuntime, destroyCurrentRuntime, purgeCurrentRuntime } =
    useSQLiteRuntimeActions({
      bootGenerationRef,
      bootingRef,
      currentDbNameRef,
      log,
      reuseWorker,
      runtimeOperationRef,
      runtimeRef,
      targetDbNameRef,
      tearleads,
    });
  const recovery = useSQLiteRuntimeRecovery({
    destroyCurrentRuntime,
    log,
    logError,
    purgeCurrentRuntime,
    spawnRuntimeForDbName: spawnRuntimeRef,
  });
  const spawnRuntimeForDbName = useSpawnSQLiteRuntimeForDbName({
    ...recovery,
    bootGenerationRef,
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    log,
    logError,
    persistence: persistencePolicy.databasePersistence,
    resolveCipherKey,
    reuseWorker,
    runtimeOperationRef,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  });
  useEffect(() => {
    spawnRuntimeRef.current = spawnRuntimeForDbName;
  }, [spawnRuntimeForDbName]);
  const controls = useSQLiteRuntimeControls({
    clearCurrentRuntime,
    currentDbNameRef,
    destroyCurrentRuntime,
    log,
    purgeCurrentRuntime,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  });

  useSQLiteRuntimeLifecycle(
    dbName,
    targetDbNameRef,
    currentDbNameRef,
    runtimeRef,
    destroyCurrentRuntime,
    log,
    reuseWorker,
  );
  useReleaseRuntimeOnPageHide(runtimeRef, runtimeOperationRef);

  return {
    id: snapshot.id,
    client: snapshot.client,
    status: snapshot.status,
    ...controls,
  };
}
