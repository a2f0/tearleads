import type {
  DatabaseSnapshot,
  DatabaseStatus,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  type DatabasePersistenceMode,
  purgeOpfsSqliteDatabase,
  type SQLiteRuntime,
  type StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";
import { sqliteDbNameForSigningFingerprint } from "./sqliteDbName";
import {
  canReuseSQLiteRuntime,
  releaseSQLiteRuntime,
  startSQLiteRuntimeBoot,
} from "./sqliteRuntimeLifecycle";
import { useReleaseRuntimeOnPageHide } from "./useReleaseRuntimeOnPageHide";
import { useTransientBootFailureRecovery } from "./useTransientBootFailureRecovery";
import { useUnreadableDatabaseRecovery } from "./useUnreadableDatabaseRecovery";
import { waitForReadySQLiteRuntime } from "./waitForReadySQLiteRuntime";

type SQLiteRuntimeStatus = DatabaseStatus;
interface SQLiteRuntimeRelease {
  readonly promise: Promise<void>;
  readonly runtime: SQLiteRuntime;
}

export interface DatabaseContextValue {
  id: string | null;
  client: DatabaseSnapshot["client"];
  status: SQLiteRuntimeStatus;
  /**
   * Tear the current runtime down (→ idle). Use where terminating the worker is
   * the intent: Explorer's Retry, a PIN lock, Destroy Key Pair. Never leaves a
   * decrypted database open with its key resident in the worker.
   */
  clearWorker: () => void;
  /**
   * Detach the database for an identity transition, retaining a reusable worker
   * when the host supports it.
   */
  clearWorkerForIdentitySwitch: () => void;
  ensureIdentityReady: (signingFingerprint: string) => Promise<void>;
  ensureReady: () => Promise<void>;
  killWorker: () => void;
  /**
   * Wipe the persisted database and tear its worker down before resolving.
   */
  purgeWorker: () => Promise<void>;
  spawnWorker: () => void;
}

function destroyRuntime(
  runtimeRef: RefObject<SQLiteRuntime | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  runtimeReleaseRef: RefObject<SQLiteRuntimeRelease | null>,
  tearleads: Tearleads,
  nextStatus: SQLiteRuntimeStatus,
) {
  const runtime = runtimeRef.current;
  if (runtime) {
    runtimeRef.current = null;
    const release = releaseSQLiteRuntime(runtime);
    const runtimeRelease = { promise: release, runtime };
    runtimeReleaseRef.current = runtimeRelease;
    void release.then(() => {
      if (runtimeReleaseRef.current === runtimeRelease) {
        runtimeReleaseRef.current = null;
      }
    });
  }

  bootingRef.current = false;
  currentDbNameRef.current = null;
  tearleads.database.clear(nextStatus);
}

async function purgeRuntime(
  runtimeRef: RefObject<SQLiteRuntime | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  targetDbNameRef: RefObject<string>,
  tearleads: Tearleads,
) {
  const runtime = runtimeRef.current;
  // The db name to wipe: the live runtime's db, else the target we would boot.
  const dbName = currentDbNameRef.current ?? targetDbNameRef.current;
  runtimeRef.current = null;
  bootingRef.current = false;
  currentDbNameRef.current = null;

  if (runtime) {
    // Wipe persisted files before termination; deleteData awaits confirmation.
    await runtime.deleteData();
  } else if (dbName) {
    // With no live worker, wipe its SAHPool directory from the main thread.
    await purgeOpfsSqliteDatabase(dbName);
  }

  tearleads.database.clear("idle");
}

function useDestroySQLiteRuntime(params: {
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  currentDbNameRef: RefObject<string | null>;
  runtimeReleaseRef: RefObject<SQLiteRuntimeRelease | null>;
  tearleads: Tearleads;
}) {
  const {
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    runtimeReleaseRef,
    tearleads,
  } = params;

  return useCallback(
    (nextStatus: SQLiteRuntimeStatus) => {
      destroyRuntime(
        runtimeRef,
        bootingRef,
        currentDbNameRef,
        runtimeReleaseRef,
        tearleads,
        nextStatus,
      );
    },
    [bootingRef, currentDbNameRef, runtimeRef, runtimeReleaseRef, tearleads],
  );
}

function usePurgeSQLiteRuntime(params: {
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  currentDbNameRef: RefObject<string | null>;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    targetDbNameRef,
    tearleads,
  } = params;

  return useCallback(
    () =>
      purgeRuntime(
        runtimeRef,
        bootingRef,
        currentDbNameRef,
        targetDbNameRef,
        tearleads,
      ),
    [bootingRef, currentDbNameRef, runtimeRef, targetDbNameRef, tearleads],
  );
}

function useSQLiteRuntimeLifecycle(
  dbName: string,
  targetDbNameRef: RefObject<string>,
  currentDbNameRef: RefObject<string | null>,
  runtimeRef: RefObject<SQLiteRuntime | null>,
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void,
  reuseWorker: boolean,
) {
  useEffect(() => {
    targetDbNameRef.current = dbName;
    if (
      !canReuseSQLiteRuntime(reuseWorker, runtimeRef.current) &&
      currentDbNameRef.current &&
      currentDbNameRef.current !== dbName
    ) {
      destroyCurrentRuntime("idle");
    }
  }, [
    currentDbNameRef,
    dbName,
    destroyCurrentRuntime,
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
  bootingRef: RefObject<boolean>;
  createSQLiteRuntime: () => SQLiteRuntime;
  currentDbNameRef: RefObject<string | null>;
  killedRef: RefObject<boolean>;
  log: (message: string) => void;
  onUnreadableDatabase: (dbName: string) => void;
  onTransientBootFailure: (dbName: string) => boolean;
  onBootSucceeded: (dbName: string) => void;
  persistence: DatabasePersistenceMode;
  resolveCipherKey: ResolveSqliteCipherKey;
  reuseWorker: boolean;
  runtimeReleaseRef: RefObject<SQLiteRuntimeRelease | null>;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    killedRef,
    log,
    onUnreadableDatabase,
    onTransientBootFailure,
    onBootSucceeded,
    persistence,
    resolveCipherKey,
    reuseWorker,
    runtimeReleaseRef,
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
        reuseWorker,
        runtimeRef,
        targetDbNameRef,
        tearleads,
      });
    },
    [
      bootingRef,
      createSQLiteRuntime,
      currentDbNameRef,
      killedRef,
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
      const pendingRelease = runtimeReleaseRef.current?.promise ?? null;
      if (pendingRelease) {
        void pendingRelease.then(() => {
          if (
            mountedRef.current &&
            targetDbNameRef.current === nextDbName &&
            !runtimeRef.current &&
            !bootingRef.current
          ) {
            spawnRuntime(nextDbName);
          }
        });
        return;
      }

      spawnRuntime(nextDbName);
    },
    [bootingRef, runtimeRef, runtimeReleaseRef, spawnRuntime, targetDbNameRef],
  );
}

function useEnsureReadyForDbName(params: {
  currentDbNameRef: RefObject<string | null>;
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  reuseWorker: boolean;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  spawnRuntimeForDbName: (nextDbName: string) => void;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    currentDbNameRef,
    destroyCurrentRuntime,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  } = params;
  return useCallback(
    (nextDbName: string) => {
      targetDbNameRef.current = nextDbName;
      const canReuse = canReuseSQLiteRuntime(reuseWorker, runtimeRef.current);
      if (
        !canReuse &&
        currentDbNameRef.current &&
        currentDbNameRef.current !== nextDbName
      ) {
        destroyCurrentRuntime("idle");
      }
      if (
        currentDbNameRef.current === nextDbName &&
        tearleads.database.status === "error"
      ) {
        if (canReuse) {
          currentDbNameRef.current = null;
          tearleads.database.clear("idle");
        } else {
          destroyCurrentRuntime("idle");
        }
      }

      return waitForReadySQLiteRuntime(
        tearleads,
        currentDbNameRef,
        nextDbName,
        () => spawnRuntimeForDbName(nextDbName),
      );
    },
    [
      currentDbNameRef,
      destroyCurrentRuntime,
      reuseWorker,
      runtimeRef,
      spawnRuntimeForDbName,
      tearleads,
    ],
  );
}

function useSQLiteRuntimeControls(params: {
  currentDbNameRef: RefObject<string | null>;
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  killedRef: RefObject<boolean>;
  log: (message: string) => void;
  purgeCurrentRuntime: () => Promise<void>;
  reuseWorker: boolean;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  spawnRuntimeForDbName: (nextDbName: string) => void;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    currentDbNameRef,
    destroyCurrentRuntime,
    killedRef,
    log,
    purgeCurrentRuntime,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  } = params;
  const ensureReadyForDbName = useEnsureReadyForDbName({
    currentDbNameRef,
    destroyCurrentRuntime,
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

  // Locks, wipes, and explicit retries must terminate the decrypted runtime.
  const clearWorker = useCallback(() => {
    destroyCurrentRuntime("idle");
  }, [destroyCurrentRuntime]);

  // Detach the old database from SDK consumers while retaining a capable worker.
  const clearWorkerForIdentitySwitch = useCallback(() => {
    if (canReuseSQLiteRuntime(reuseWorker, runtimeRef.current)) {
      // Only a ready database is safe to reattach on same-identity rollback.
      // Force an errored one through close + renew + boot.
      if (tearleads.database.status === "error") {
        currentDbNameRef.current = null;
      }
      tearleads.database.clear("idle");
      return;
    }

    destroyCurrentRuntime("idle");
  }, [
    currentDbNameRef,
    destroyCurrentRuntime,
    reuseWorker,
    runtimeRef,
    tearleads,
  ]);

  const killWorker = useCallback(() => {
    if (!runtimeRef.current) {
      return;
    }

    killedRef.current = true;
    destroyCurrentRuntime("terminated");
    log("Worker killed");
  }, [destroyCurrentRuntime, log]);

  const purgeWorker = useCallback(async () => {
    killedRef.current = true;
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
  const bootingRef = useRef(false);
  const targetDbNameRef = useRef(dbName);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const runtimeReleaseRef = useRef<SQLiteRuntimeRelease | null>(null);
  // Indirection breaks the cycle between spawn and its recovery handlers.
  const spawnRuntimeRef = useRef<(dbName: string) => void>(() => {});
  const destroyCurrentRuntime = useDestroySQLiteRuntime({
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    runtimeReleaseRef,
    tearleads,
  });
  const purgeCurrentRuntime = usePurgeSQLiteRuntime({
    runtimeRef,
    bootingRef,
    currentDbNameRef,
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
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    killedRef,
    log,
    onUnreadableDatabase,
    onTransientBootFailure: recoverFromBootTimeout,
    onBootSucceeded,
    persistence: persistencePolicy.databasePersistence,
    resolveCipherKey,
    reuseWorker,
    runtimeReleaseRef,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  });
  useEffect(() => {
    spawnRuntimeRef.current = spawnRuntimeForDbName;
  }, [spawnRuntimeForDbName]);
  const controls = useSQLiteRuntimeControls({
    currentDbNameRef,
    destroyCurrentRuntime,
    killedRef,
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
    reuseWorker,
  );
  useReleaseRuntimeOnPageHide(runtimeRef, runtimeReleaseRef);

  return {
    id: snapshot.id,
    client: snapshot.client,
    status: snapshot.status,
    ...controls,
  };
}
