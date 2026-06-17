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
import { bootSQLiteRuntime } from "./bootSQLiteRuntime";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";
import { sqliteDbNameForSigningFingerprint } from "./sqliteDbName";
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
  tearleads: Tearleads,
  nextStatus: SQLiteRuntimeStatus,
) {
  if (runtimeRef.current) {
    runtimeRef.current.destroy();
    runtimeRef.current = null;
  }

  bootingRef.current = false;
  currentDbNameRef.current = null;
  tearleads.database.clear(nextStatus);
}

async function purgeRuntime(
  runtimeRef: RefObject<SQLiteRuntime | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  tearleads: Tearleads,
) {
  const runtime = runtimeRef.current;
  runtimeRef.current = null;
  bootingRef.current = false;
  currentDbNameRef.current = null;

  if (runtime) {
    // Wipe the persisted OPFS files (not just release the handles) before the
    // worker terminates. deleteData() awaits the worker's confirmation.
    await runtime.deleteData();
  }

  tearleads.database.clear("idle");
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
  tearleads: Tearleads;
}) {
  const { runtimeRef, bootingRef, currentDbNameRef, tearleads } = params;

  return useCallback(
    (nextStatus: SQLiteRuntimeStatus) => {
      destroyRuntime(
        runtimeRef,
        bootingRef,
        currentDbNameRef,
        tearleads,
        nextStatus,
      );
    },
    [bootingRef, currentDbNameRef, runtimeRef, tearleads],
  );
}

function usePurgeSQLiteRuntime(params: {
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  currentDbNameRef: RefObject<string | null>;
  tearleads: Tearleads;
}) {
  const { runtimeRef, bootingRef, currentDbNameRef, tearleads } = params;

  return useCallback(
    () => purgeRuntime(runtimeRef, bootingRef, currentDbNameRef, tearleads),
    [bootingRef, currentDbNameRef, runtimeRef, tearleads],
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
    runtimeRef,
    targetDbNameRef,
    tearleads,
  } = params;

  return useCallback(
    (nextDbName: string) => {
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
          })
          .catch((error) => {
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
    },
    [
      bootingRef,
      createSQLiteRuntime,
      currentDbNameRef,
      killedRef,
      log,
      persistence,
      resolveCipherKey,
      runtimeRef,
      targetDbNameRef,
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
  const destroyCurrentRuntime = useDestroySQLiteRuntime({
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    tearleads,
  });
  const purgeCurrentRuntime = usePurgeSQLiteRuntime({
    runtimeRef,
    bootingRef,
    currentDbNameRef,
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
