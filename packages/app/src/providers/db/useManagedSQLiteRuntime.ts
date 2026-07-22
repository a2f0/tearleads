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
   * Release the current database ahead of an identity transition that opens a
   * DIFFERENT one. Under host worker reuse this keeps a healthy worker alive so
   * the switch reuses it; otherwise (or on an errored runtime) it tears down.
   */
  clearWorkerForIdentitySwitch: () => void;
  ensureIdentityReady: (signingFingerprint: string) => Promise<void>;
  ensureReady: () => Promise<void>;
  killWorker: () => void;
  /**
   * Permanently wipe the current database's persisted OPFS files, then tear the
   * worker down. Use when discarding local data on logout. Resolves once the
   * wipe + teardown completes.
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
    // Wipe the persisted OPFS files (not just release the handles) before the
    // worker terminates. deleteData() awaits the worker's confirmation.
    await runtime.deleteData();
  } else if (dbName) {
    // No live worker (cleared/killed/failed to boot), so deleteData() cannot
    // run. Fall back to deleting the database's SAHPool OPFS directory from the
    // main thread so opting out of keeping local data still wipes SQLite. Safe
    // because no worker holds the access handles here.
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
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void,
  reuseWorker: boolean,
) {
  useEffect(() => {
    targetDbNameRef.current = dbName;
    if (
      // Under worker reuse a database change is applied in-place (close + re-init
      // on the same worker) by the imperative ensureReady path, so a reactive
      // dbName change must NOT tear the runtime down — doing so would force a new
      // worker on the next spawn. The imperative reboot targets the final
      // database directly, so intermediate reactive values are simply ignored.
      !reuseWorker &&
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

  // Callers (the returned spawner, and its pending-release continuation) already
  // gate on mountedRef before invoking this.
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
  spawnRuntimeForDbName: (nextDbName: string) => void;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    currentDbNameRef,
    destroyCurrentRuntime,
    reuseWorker,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  } = params;
  return useCallback(
    (nextDbName: string) => {
      targetDbNameRef.current = nextDbName;
      if (
        // Under reuse a database change is applied in-place by
        // spawnRuntimeForDbName (close + re-init on the same worker); tearing the
        // runtime down here would force a new worker on the next spawn instead.
        !reuseWorker &&
        currentDbNameRef.current &&
        currentDbNameRef.current !== nextDbName
      ) {
        destroyCurrentRuntime("idle");
      }
      // A failed init pins the target DB in error; retry with a fresh worker even
      // under reuse — the worker may be wedged, so a clean respawn is safer.
      if (
        currentDbNameRef.current === nextDbName &&
        tearleads.database.status === "error"
      ) {
        destroyCurrentRuntime("idle");
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

  // Always tears the runtime down. Used where terminating the worker is the
  // point — Explorer's Retry (reset an errored runtime to idle so it re-spawns),
  // a PIN lock, and Destroy Key Pair — which must not leave the decrypted
  // database open with its key resident in the worker. Distinct from
  // clearWorkerForIdentitySwitch, which reuses the worker.
  const clearWorker = useCallback(() => {
    destroyCurrentRuntime("idle");
  }, [destroyCurrentRuntime]);

  // Used when an identity transition is about to open a DIFFERENT database.
  // Under worker reuse, keep the worker so the imminent ensureReady reuses it
  // (close + re-init on the same worker) instead of constructing a new one — the
  // second-identity provisioning hang. Keep it even when the current boot ended
  // in "error": a pre-init failure (e.g. a cipher-key timeout) leaves the worker
  // itself healthy, so it must stay reusable — restoring the previous identity
  // must not have to build a second worker (which fails on a WebView, leaving the
  // app keyless). A genuinely wedged worker is torn down by the boot-timeout
  // recovery on the reuse re-init, not here. A non-reuse host still tears down.
  const clearWorkerForIdentitySwitch = useCallback(() => {
    if (reuseWorker && runtimeRef.current) {
      return;
    }

    destroyCurrentRuntime("idle");
  }, [destroyCurrentRuntime, reuseWorker, runtimeRef]);

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
  // Spawn is indirected through a ref to break the cycle with recovery: spawn
  // needs the unreadable-database handler, and the handler needs spawn.
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
