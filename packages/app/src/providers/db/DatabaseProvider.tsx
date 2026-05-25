import type {
  DatabaseSnapshot,
  DatabaseStatus,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  createModuleSQLiteRuntime,
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
import { useIdentity } from "../identity/IdentityProvider";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";

type SQLiteRuntimeStatus = DatabaseStatus;

interface DatabaseContextValue {
  id: string | null;
  client: DatabaseSnapshot["client"];
  status: SQLiteRuntimeStatus;
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
  status: SQLiteRuntimeStatus,
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
  configureSdkSQLiteRuntime(tearleads, runtime, "ready");
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
  dbName: string | null,
  status: SQLiteRuntimeStatus,
  runtimeRef: RefObject<SQLiteRuntime | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  killedRef: RefObject<boolean>,
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void,
  spawnRuntime: () => void,
) {
  useEffect(() => {
    if (!dbName) {
      if (runtimeRef.current || status !== "idle") {
        destroyCurrentRuntime("idle");
      }
      return;
    }

    if (currentDbNameRef.current !== dbName) {
      killedRef.current = false;
      destroyCurrentRuntime("idle");
      spawnRuntime();
      return;
    }

    if (!killedRef.current && !runtimeRef.current && !bootingRef.current) {
      spawnRuntime();
    }
  }, [
    bootingRef,
    currentDbNameRef,
    dbName,
    destroyCurrentRuntime,
    killedRef,
    runtimeRef,
    spawnRuntime,
    status,
  ]);

  useEffect(() => {
    return () => {
      destroyCurrentRuntime("idle");
    };
  }, [destroyCurrentRuntime]);
}

function useManagedSQLiteRuntime(
  createSQLiteRuntime: () => SQLiteRuntime,
  dbName: string | null,
  log: (message: string) => void,
  tearleads: Tearleads,
): DatabaseContextValue {
  const snapshot = useTearleadsStoreSnapshot(tearleads.database);
  const runtimeRef = useRef<SQLiteRuntime | null>(null);
  const bootingRef = useRef(false);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const destroyCurrentRuntime = useDestroySQLiteRuntime({
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    tearleads,
  });

  const spawnRuntime = useCallback(() => {
    if (!dbName || runtimeRef.current || bootingRef.current) {
      return;
    }

    killedRef.current = false;
    bootingRef.current = true;
    currentDbNameRef.current = dbName;

    try {
      const runtime = createSQLiteRuntime();
      runtimeRef.current = runtime;
      configureSdkSQLiteRuntime(tearleads, runtime, "idle");

      void bootSQLiteRuntime(runtime, dbName, log)
        .then(() => {
          completeSQLiteRuntimeBoot({
            runtime,
            runtimeRef,
            bootingRef,
            tearleads,
            dbName,
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
  }, [createSQLiteRuntime, dbName, log, tearleads]);

  const killWorker = useCallback(() => {
    if (!runtimeRef.current) {
      return;
    }

    killedRef.current = true;
    destroyCurrentRuntime("terminated");
    log("Worker killed");
  }, [destroyCurrentRuntime, log]);

  useSQLiteRuntimeLifecycle(
    dbName,
    snapshot.status,
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    killedRef,
    destroyCurrentRuntime,
    spawnRuntime,
  );

  return {
    id: snapshot.id,
    client: snapshot.client,
    status: snapshot.status,
    killWorker,
    spawnWorker: spawnRuntime,
  };
}

export function DatabaseProvider({ children }: PropsWithChildren) {
  const { createSQLiteRuntime = createModuleSQLiteRuntime } =
    useAppHostConfig();
  const tearleads = useTearleads();
  const { log } = useLog();
  const { signingFingerprint } = useIdentity();
  const dbName =
    signingFingerprint === null
      ? null
      : `/app-identity-${signingFingerprint}.db`;
  const value = useManagedSQLiteRuntime(
    createSQLiteRuntime,
    dbName,
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
