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

type SQLiteRuntimeStatus = DatabaseStatus;

export interface DatabaseContextValue {
  id: string | null;
  client: DatabaseSnapshot["client"];
  status: SQLiteRuntimeStatus;
  clearWorker: () => void;
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
  runtimeReleaseRef: RefObject<Promise<void> | null>,
  tearleads: Tearleads,
  nextStatus: SQLiteRuntimeStatus,
) {
  const runtime = runtimeRef.current;
  if (runtime) {
    runtimeRef.current = null;
    const release = releaseSQLiteRuntime(runtime);
    runtimeReleaseRef.current = release;
    void release.then(() => {
      if (runtimeReleaseRef.current === release) {
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

function waitForReadySQLiteRuntime(
  tearleads: Tearleads,
  currentDbNameRef: RefObject<string | null>,
  dbName: string,
  spawnRuntime: () => void,
): Promise<void> {
  if (
    tearleads.database.status === "ready" &&
    tearleads.database.client &&
    currentDbNameRef.current === dbName
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (settled) {
        return;
      }

      const { client, status } = tearleads.database.snapshot;
      if (status === "ready" && client && currentDbNameRef.current === dbName) {
        settled = true;
        unsubscribe?.();
        resolve();
      } else if (status === "error" && currentDbNameRef.current === dbName) {
        settled = true;
        unsubscribe?.();
        reject(new Error("SQLite database failed to initialize."));
      }
    };

    unsubscribe = tearleads.database.subscribe(finish);
    finish();
    if (!settled) {
      spawnRuntime();
      finish();
    }
  });
}

function useDestroySQLiteRuntime(params: {
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  currentDbNameRef: RefObject<string | null>;
  runtimeReleaseRef: RefObject<Promise<void> | null>;
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
) {
  useEffect(() => {
    targetDbNameRef.current = dbName;
    if (currentDbNameRef.current && currentDbNameRef.current !== dbName) {
      destroyCurrentRuntime("idle");
    }
  }, [currentDbNameRef, dbName, destroyCurrentRuntime, targetDbNameRef]);

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
  persistence: DatabasePersistenceMode;
  resolveCipherKey: ResolveSqliteCipherKey;
  runtimeReleaseRef: RefObject<Promise<void> | null>;
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
    persistence,
    resolveCipherKey,
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

  const spawnRuntime = useCallback(
    (nextDbName: string) => {
      if (!mountedRef.current) {
        return;
      }

      startSQLiteRuntimeBoot({
        bootingRef,
        createSQLiteRuntime,
        currentDbNameRef,
        killedRef,
        log,
        nextDbName,
        persistence,
        resolveCipherKey,
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
      mountedRef,
      persistence,
      resolveCipherKey,
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
      const pendingRelease = runtimeReleaseRef.current;
      if (pendingRelease) {
        void pendingRelease.then(() => {
          if (!mountedRef.current) {
            return;
          }
          if (targetDbNameRef.current !== nextDbName) {
            return;
          }
          if (runtimeRef.current || bootingRef.current) {
            return;
          }

          spawnRuntime(nextDbName);
        });
        return;
      }

      spawnRuntime(nextDbName);
    },
    [
      bootingRef,
      mountedRef,
      runtimeRef,
      runtimeReleaseRef,
      spawnRuntime,
      targetDbNameRef,
    ],
  );
}

function useSQLiteRuntimeControls(params: {
  currentDbNameRef: RefObject<string | null>;
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  killedRef: RefObject<boolean>;
  log: (message: string) => void;
  purgeCurrentRuntime: () => Promise<void>;
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
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  } = params;
  const ensureReadyForDbName = useCallback(
    (nextDbName: string) => {
      targetDbNameRef.current = nextDbName;
      if (currentDbNameRef.current && currentDbNameRef.current !== nextDbName) {
        destroyCurrentRuntime("idle");
      }
      // A failed init leaves the target DB pinned in error; retry with a fresh worker.
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
    [currentDbNameRef, destroyCurrentRuntime, spawnRuntimeForDbName, tearleads],
  );

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

  const clearWorker = useCallback(() => {
    destroyCurrentRuntime("idle");
  }, [destroyCurrentRuntime]);

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
): DatabaseContextValue {
  const snapshot = useTearleadsStoreSnapshot(tearleads.database);
  const runtimeRef = useRef<SQLiteRuntime | null>(null);
  const bootingRef = useRef(false);
  const targetDbNameRef = useRef(dbName);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const runtimeReleaseRef = useRef<Promise<void> | null>(null);
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
  const spawnRuntimeForDbName = useSpawnSQLiteRuntimeForDbName({
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    killedRef,
    log,
    persistence: persistencePolicy.databasePersistence,
    resolveCipherKey,
    runtimeReleaseRef,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  });
  const controls = useSQLiteRuntimeControls({
    currentDbNameRef,
    destroyCurrentRuntime,
    killedRef,
    log,
    purgeCurrentRuntime,
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
  );
  useReleaseRuntimeOnPageHide(runtimeRef);

  return {
    id: snapshot.id,
    client: snapshot.client,
    status: snapshot.status,
    ...controls,
  };
}
