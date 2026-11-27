import type {
  DatabaseSnapshot,
  DatabaseStatus,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  type DatabasePersistenceMode,
  isDatabaseConnectionLostError,
  type SQLiteRuntime,
  type StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { useWarnBeforeUnloadWithPendingDocumentWrites } from "./useWarnBeforeUnloadWithPendingDocumentWrites";

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
  purgeWorker: (current?: () => boolean) => Promise<void>;
  /** Wipe only this fingerprint's database, including when it is not open. */
  purgeIdentityDatabase: (signingFingerprint: string) => Promise<void>;
  spawnWorker: () => void;
  /** True while boot is retrying behind another tab's restore or transaction. */
  waitingForAnotherTab?: boolean;
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
  onUnreadableDatabase: (dbName: string, cause: unknown) => void;
  onTransientBootFailure: (dbName: string) => boolean;
  onBootSucceeded: (dbName: string) => void;
  onWaitingForAnotherTab: (waiting: boolean) => void;
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
    onWaitingForAnotherTab,
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
        onWaitingForAnotherTab,
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
      onWaitingForAnotherTab,
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
// `waitForReadySQLiteRuntime` rejects and the retry surface appears. A browser
// tab whose open database went away with another tab's owner worker is not
// broken: closing that tab is ordinary. Neither is one whose transaction the
// worker rolled back after it sat idle while another tab waited. Its runtime
// is retired to idle, which the identity boot reopens at once without
// spending the retry budget that bounds real failures (see
// useEnsureDatabaseForIdentity), and it is logged with the error's own detail
// (a revocation names the database, the idle time, and how many statements
// waited) rather than reported as a crash.
function useWorkerCrashRecovery(params: {
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
}): (error: Error) => void {
  const { destroyCurrentRuntime, log, logError } = params;
  return useCallback(
    (error: Error) => {
      if (isDatabaseConnectionLostError(error)) {
        log(`Database connection lost; reopening. ${error.message}`);
        destroyCurrentRuntime("idle");
        return;
      }
      logError("Database worker crashed; surfacing error", error);
      destroyCurrentRuntime("error");
    },
    [destroyCurrentRuntime, log, logError],
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
    log,
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

function useSQLiteRuntimeRefs(dbName: string) {
  return {
    bootGenerationRef: useRef(0),
    bootingRef: useRef(false),
    currentDbNameRef: useRef<string | null>(null),
    runtimeOperationRef: useRef<SQLiteRuntimeOperation | null>(null),
    runtimeRef: useRef<SQLiteRuntime | null>(null),
    targetDbNameRef: useRef(dbName),
  };
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
  const [waitingForAnotherTab, setWaitingForAnotherTab] = useState(false);
  const resetWaitingForAnotherTab = useCallback(
    () => setWaitingForAnotherTab(false),
    [],
  );
  const refs = useSQLiteRuntimeRefs(dbName);
  // Indirection breaks the cycle between spawn and its recovery handlers.
  const spawnRuntimeRef = useRef<(nextDbName: string) => void>(() => {});
  const { clearCurrentRuntime, destroyCurrentRuntime, purgeCurrentRuntime } =
    useSQLiteRuntimeActions({
      ...refs,
      log,
      onResetWaitingForAnotherTab: resetWaitingForAnotherTab,
      reuseWorker,
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
    ...refs,
    createSQLiteRuntime,
    log,
    logError,
    onWaitingForAnotherTab: setWaitingForAnotherTab,
    persistence: persistencePolicy.databasePersistence,
    resolveCipherKey,
    reuseWorker,
    tearleads,
  });
  useEffect(() => {
    spawnRuntimeRef.current = spawnRuntimeForDbName;
  }, [spawnRuntimeForDbName]);
  const controls = useSQLiteRuntimeControls({
    ...refs,
    clearCurrentRuntime,
    destroyCurrentRuntime,
    log,
    purgeCurrentRuntime,
    reuseWorker,
    spawnRuntimeForDbName,
    tearleads,
  });

  useSQLiteRuntimeLifecycle(
    dbName,
    refs.targetDbNameRef,
    refs.currentDbNameRef,
    refs.runtimeRef,
    destroyCurrentRuntime,
    log,
    reuseWorker,
  );
  useReleaseRuntimeOnPageHide(refs.runtimeRef, refs.runtimeOperationRef);
  useWarnBeforeUnloadWithPendingDocumentWrites(tearleads);

  return {
    id: snapshot.id,
    client: snapshot.client,
    status: snapshot.status,
    waitingForAnotherTab: waitingForAnotherTab && snapshot.status === "idle",
    ...controls,
  };
}
