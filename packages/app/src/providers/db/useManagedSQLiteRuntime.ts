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
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";
import { sqliteDbNameForSigningFingerprint } from "./sqliteDbName";
import { startSQLiteRuntimeBoot } from "./sqliteRuntimeLifecycle";
import {
  canReuseSQLiteRuntime,
  logSQLiteRuntimeReuseUnavailable,
} from "./sqliteRuntimeRetention";
import { useReleaseRuntimeOnPageHide } from "./useReleaseRuntimeOnPageHide";
import {
  type SQLiteRuntimeOperation,
  useSQLiteRuntimeActions,
} from "./useSQLiteRuntimeActions";
import { useTransientBootFailureRecovery } from "./useTransientBootFailureRecovery";
import { useUnreadableDatabaseRecovery } from "./useUnreadableDatabaseRecovery";
import { waitForReadySQLiteRuntime } from "./waitForReadySQLiteRuntime";

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

function useSpawnSQLiteRuntimeForDbName(params: {
  bootGenerationRef: RefObject<number>;
  bootingRef: RefObject<boolean>;
  createSQLiteRuntime: () => SQLiteRuntime;
  currentDbNameRef: RefObject<string | null>;
  log: (message: string) => void;
  onUnreadableDatabase: (dbName: string) => void;
  onTransientBootFailure: (dbName: string) => boolean;
  onBootSucceeded: (dbName: string) => void;
  persistence: DatabasePersistenceMode;
  resolveCipherKey: ResolveSqliteCipherKey;
  reuseWorker: boolean;
  runtimeOperationRef: RefObject<SQLiteRuntimeOperation | null>;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    bootGenerationRef,
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    log,
    onUnreadableDatabase,
    onTransientBootFailure,
    onBootSucceeded,
    persistence,
    resolveCipherKey,
    reuseWorker,
    runtimeOperationRef,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  } = params;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Callers already gate on mountedRef before invoking this.
  const spawnRuntime = useCallback(
    (nextDbName: string) => {
      startSQLiteRuntimeBoot({
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

function useEnsureReadyForDbName(params: {
  clearCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  currentDbNameRef: RefObject<string | null>;
  reuseWorker: boolean;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  spawnRuntimeForDbName: (nextDbName: string) => void;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    clearCurrentRuntime,
    currentDbNameRef,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  } = params;
  const readinessGenerationRef = useRef(0);
  const readinessTargetDbNameRef = useRef<string | null>(null);
  return useCallback(
    (nextDbName: string) => {
      if (readinessTargetDbNameRef.current !== nextDbName) {
        readinessTargetDbNameRef.current = nextDbName;
        readinessGenerationRef.current += 1;
      }
      const readinessGeneration = readinessGenerationRef.current;
      targetDbNameRef.current = nextDbName;
      const canReuse = canReuseSQLiteRuntime(reuseWorker, runtimeRef.current);
      if (
        !canReuse &&
        currentDbNameRef.current &&
        currentDbNameRef.current !== nextDbName
      ) {
        clearCurrentRuntime("idle");
      }
      if (
        currentDbNameRef.current === nextDbName &&
        tearleads.database.status === "error"
      ) {
        clearCurrentRuntime("idle");
      }

      return waitForReadySQLiteRuntime(
        tearleads,
        currentDbNameRef,
        readinessGenerationRef,
        readinessGeneration,
        nextDbName,
        () => spawnRuntimeForDbName(nextDbName),
      );
    },
    [
      clearCurrentRuntime,
      currentDbNameRef,
      reuseWorker,
      runtimeRef,
      spawnRuntimeForDbName,
      targetDbNameRef,
      tearleads,
    ],
  );
}

function useSQLiteRuntimeControls(params: {
  clearCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  currentDbNameRef: RefObject<string | null>;
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  log: (message: string) => void;
  purgeCurrentRuntime: () => Promise<void>;
  reuseWorker: boolean;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  spawnRuntimeForDbName: (nextDbName: string) => void;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
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
  } = params;
  const ensureReadyForDbName = useEnsureReadyForDbName({
    clearCurrentRuntime,
    currentDbNameRef,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  });

  const spawnRuntime = useCallback(() => {
    spawnRuntimeForDbName(targetDbNameRef.current);
  }, [spawnRuntimeForDbName]);

  const ensureReady = useCallback(
    () => ensureReadyForDbName(targetDbNameRef.current),
    [ensureReadyForDbName],
  );

  const ensureIdentityReady = useCallback(
    (signingFingerprint: string) =>
      ensureReadyForDbName(
        sqliteDbNameForSigningFingerprint(signingFingerprint),
      ),
    [ensureReadyForDbName],
  );

  // Detach SDK consumers, close the decrypted database, and retain a capable
  // physical worker for the next boot.
  const clearWorker = useCallback(() => {
    clearCurrentRuntime("idle");
  }, [clearCurrentRuntime]);

  // Identity changes use the same safe close-and-renew path. In particular, a
  // failed creation with no rollback target cannot leave the old DB open.
  const clearWorkerForIdentitySwitch = useCallback(() => {
    clearCurrentRuntime("idle");
  }, [clearCurrentRuntime]);

  const killWorker = useCallback(() => {
    if (!runtimeRef.current) {
      return;
    }

    destroyCurrentRuntime("terminated");
    log("Worker killed");
  }, [destroyCurrentRuntime, log]);

  const purgeWorker = useCallback(async () => {
    await purgeCurrentRuntime();
    log("Local database wiped");
  }, [log, purgeCurrentRuntime]);

  return {
    clearWorker,
    clearWorkerForIdentitySwitch,
    ensureIdentityReady,
    ensureReady,
    killWorker,
    purgeWorker,
    spawnWorker: spawnRuntime,
  };
}

export function useManagedSQLiteRuntime(
  createSQLiteRuntime: () => SQLiteRuntime,
  dbName: string,
  persistencePolicy: StoragePersistencePolicy,
  resolveCipherKey: ResolveSqliteCipherKey,
  log: (message: string) => void,
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
  const onUnreadableDatabase = useUnreadableDatabaseRecovery({
    destroyCurrentRuntime,
    log,
    purgeCurrentRuntime,
    spawnRuntimeForDbName: spawnRuntimeRef,
  });
  const { clearBudget: onBootSucceeded, recoverFromBootTimeout } =
    useTransientBootFailureRecovery({
      destroyCurrentRuntime,
      log,
      spawnRuntimeForDbName: spawnRuntimeRef,
    });
  const spawnRuntimeForDbName = useSpawnSQLiteRuntimeForDbName({
    bootGenerationRef,
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    log,
    onUnreadableDatabase,
    onTransientBootFailure: recoverFromBootTimeout,
    onBootSucceeded,
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
