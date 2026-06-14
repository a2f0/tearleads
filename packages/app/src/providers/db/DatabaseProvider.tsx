import type {
  DatabaseSnapshot,
  DatabaseStatus,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  createSQLiteRuntime as createDefaultSQLiteRuntime,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import {
  createContext,
  type PropsWithChildren,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";

type SQLiteRuntimeStatus = DatabaseStatus;

interface DatabaseContextValue {
  id: string | null;
  client: DatabaseSnapshot["client"];
  status: SQLiteRuntimeStatus;
  clearWorker: () => void;
  ensureIdentityReady: (signingFingerprint: string) => Promise<void>;
  ensureReady: () => Promise<void>;
  killWorker: () => void;
  spawnWorker: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

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

async function bootSQLiteRuntime(
  runtime: SQLiteRuntime,
  dbName: string,
  log: (message: string) => void,
) {
  log("Loading SQLite3 WASM module...");
  log(`Initializing database: ${dbName}`);
  await runtime.client.init({
    dbName,
    cipher: "chacha20",
    key: "development-key",
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

function sqliteDbNameForNamespace(namespace: string): string {
  const pathSegment =
    namespace.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "default";
  return `/app-identity-bootstrap-${pathSegment}.db`;
}

function sqliteDbNameForSigningFingerprint(signingFingerprint: string): string {
  return `/app-identity-${signingFingerprint}.db`;
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

        void bootSQLiteRuntime(runtime, nextDbName, log)
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

  return {
    clearWorker,
    ensureIdentityReady,
    ensureReady,
    killWorker,
    spawnWorker: spawnRuntime,
  };
}

function useManagedSQLiteRuntime(
  createSQLiteRuntime: () => SQLiteRuntime,
  dbName: string,
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
  const spawnRuntimeForDbName = useSpawnSQLiteRuntimeForDbName({
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    killedRef,
    log,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  });
  const controls = useSQLiteRuntimeControls({
    currentDbNameRef,
    destroyCurrentRuntime,
    killedRef,
    log,
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

  return {
    id: snapshot.id,
    client: snapshot.client,
    status: snapshot.status,
    ...controls,
  };
}

export function DatabaseProvider({ children }: PropsWithChildren) {
  const {
    createSQLiteRuntime = createDefaultSQLiteRuntime,
    localIdentityNamespace,
  } = useAppHostConfig();
  const tearleads = useTearleads();
  const { log } = useLog();
  const identity = useTearleadsStoreSnapshot(tearleads.identity);
  const dbName = sqliteDbNameForNamespace(
    localIdentityNamespace ?? "tearleads.app",
  );
  const activeDbName = identity.signingFingerprint
    ? sqliteDbNameForSigningFingerprint(identity.signingFingerprint)
    : dbName;
  const value = useManagedSQLiteRuntime(
    createSQLiteRuntime,
    activeDbName,
    log,
    tearleads,
  );

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error("useDatabase must be used within a DatabaseProvider.");
  }

  return context;
}
