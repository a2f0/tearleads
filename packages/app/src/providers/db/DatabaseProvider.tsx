import type { Tearleads, TearleadsDatabaseStatus } from "@tearleads/client-sdk";
import {
  createModuleSQLiteWorkerRuntime,
  type SQLiteWorkerClient,
  type SQLiteWorkerRuntime,
} from "@tearleads/client-sdk/sqlite";
import {
  createContext,
  type PropsWithChildren,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";

type SQLiteRuntimeStatus = TearleadsDatabaseStatus;

interface DatabaseContextValue {
  id: string | null;
  client: SQLiteWorkerClient | null;
  status: SQLiteRuntimeStatus;
  killWorker: () => void;
  spawnWorker: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

function destroyRuntime(
  runtimeRef: RefObject<SQLiteWorkerRuntime | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  tearleads: Tearleads,
  setId: (value: string | null) => void,
  setClient: (value: DatabaseContextValue["client"]) => void,
  setStatus: (value: SQLiteRuntimeStatus) => void,
  nextStatus: SQLiteRuntimeStatus,
) {
  if (runtimeRef.current) {
    runtimeRef.current.destroy();
    runtimeRef.current = null;
  }

  bootingRef.current = false;
  currentDbNameRef.current = null;
  tearleads.database.clear(nextStatus);
  setId(null);
  setClient(null);
  setStatus(nextStatus);
}

async function bootSQLiteWorkerRuntime(
  runtime: SQLiteWorkerRuntime,
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
  runtime: SQLiteWorkerRuntime,
  status: SQLiteRuntimeStatus,
) {
  tearleads.database.configure({
    client: runtime.client,
    id: runtime.id,
    status,
  });
}

function completeSQLiteWorkerRuntimeBoot(params: {
  runtime: SQLiteWorkerRuntime;
  runtimeRef: RefObject<SQLiteWorkerRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  setStatus: (value: SQLiteRuntimeStatus) => void;
  dbName: string;
  log: (message: string) => void;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, setStatus, dbName, log } =
    params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  configureSdkSQLiteRuntime(tearleads, runtime, "ready");
  setStatus("ready");
  log(`Database initialized successfully: ${dbName}`);
  log("Worker spawned");
}

function failSQLiteWorkerRuntimeBoot(params: {
  runtime: SQLiteWorkerRuntime;
  runtimeRef: RefObject<SQLiteWorkerRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  setStatus: (value: SQLiteRuntimeStatus) => void;
  error: unknown;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, setStatus, error } =
    params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  console.error("Failed to initialize database worker:", error);
  configureSdkSQLiteRuntime(tearleads, runtime, "error");
  setStatus("error");
}

function useDestroySQLiteWorkerRuntime(params: {
  runtimeRef: RefObject<SQLiteWorkerRuntime | null>;
  bootingRef: RefObject<boolean>;
  currentDbNameRef: RefObject<string | null>;
  tearleads: Tearleads;
  setId: (value: string | null) => void;
  setClient: (value: DatabaseContextValue["client"]) => void;
  setStatus: (value: SQLiteRuntimeStatus) => void;
}) {
  const {
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    tearleads,
    setId,
    setClient,
    setStatus,
  } = params;

  return useCallback(
    (nextStatus: SQLiteRuntimeStatus) => {
      destroyRuntime(
        runtimeRef,
        bootingRef,
        currentDbNameRef,
        tearleads,
        setId,
        setClient,
        setStatus,
        nextStatus,
      );
    },
    [
      bootingRef,
      currentDbNameRef,
      runtimeRef,
      setClient,
      setId,
      setStatus,
      tearleads,
    ],
  );
}

function useSQLiteWorkerRuntimeLifecycle(
  dbName: string | null,
  status: SQLiteRuntimeStatus,
  runtimeRef: RefObject<SQLiteWorkerRuntime | null>,
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

function useManagedSQLiteWorkerRuntime(
  createSQLiteWorkerRuntime: () => SQLiteWorkerRuntime,
  dbName: string | null,
  log: (message: string) => void,
  tearleads: Tearleads,
): DatabaseContextValue {
  const [status, setStatus] = useState<SQLiteRuntimeStatus>("idle");
  const [id, setId] = useState<string | null>(null);
  const [client, setClient] = useState<DatabaseContextValue["client"]>(null);
  const runtimeRef = useRef<SQLiteWorkerRuntime | null>(null);
  const bootingRef = useRef(false);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const destroyCurrentRuntime = useDestroySQLiteWorkerRuntime({
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    tearleads,
    setId,
    setClient,
    setStatus,
  });

  const spawnRuntime = useCallback(() => {
    if (!dbName || runtimeRef.current || bootingRef.current) {
      return;
    }

    killedRef.current = false;
    bootingRef.current = true;
    currentDbNameRef.current = dbName;

    try {
      const runtime = createSQLiteWorkerRuntime();
      runtimeRef.current = runtime;
      configureSdkSQLiteRuntime(tearleads, runtime, "idle");
      setId(runtime.id);
      setClient(runtime.client);
      setStatus("idle");

      void bootSQLiteWorkerRuntime(runtime, dbName, log)
        .then(() => {
          completeSQLiteWorkerRuntimeBoot({
            runtime,
            runtimeRef,
            bootingRef,
            tearleads,
            setStatus,
            dbName,
            log,
          });
        })
        .catch((error) => {
          failSQLiteWorkerRuntimeBoot({
            runtime,
            runtimeRef,
            bootingRef,
            tearleads,
            setStatus,
            error,
          });
        });
    } catch (error) {
      bootingRef.current = false;
      console.error("Failed to create database worker:", error);
      tearleads.database.clear("error");
      setStatus("error");
    }
  }, [createSQLiteWorkerRuntime, dbName, log, tearleads]);

  const killWorker = useCallback(() => {
    if (!runtimeRef.current) {
      return;
    }

    killedRef.current = true;
    destroyCurrentRuntime("terminated");
    log("Worker killed");
  }, [destroyCurrentRuntime, log]);

  useSQLiteWorkerRuntimeLifecycle(
    dbName,
    status,
    runtimeRef,
    bootingRef,
    currentDbNameRef,
    killedRef,
    destroyCurrentRuntime,
    spawnRuntime,
  );

  return {
    id,
    client,
    status,
    killWorker,
    spawnWorker: spawnRuntime,
  };
}

export function DatabaseProvider({ children }: PropsWithChildren) {
  const { createSQLiteWorkerRuntime = createModuleSQLiteWorkerRuntime } =
    useAppHostConfig();
  const tearleads = useTearleads();
  const { log } = useLog();
  const { signingFingerprint } = useIdentity();
  const dbName =
    signingFingerprint === null
      ? null
      : `/app-identity-${signingFingerprint}.db`;
  const value = useManagedSQLiteWorkerRuntime(
    createSQLiteWorkerRuntime,
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
