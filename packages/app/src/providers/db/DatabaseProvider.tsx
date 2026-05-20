import type { Tearleads, TearleadsDatabaseStatus } from "@tearleads/client-sdk";
import type { DatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import {
  createModuleDatabaseRuntime,
  type DatabaseRuntime,
} from "@tearleads/sqlite-worker/runtime";
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

type DatabaseRuntimeStatus = TearleadsDatabaseStatus;

interface DatabaseContextValue {
  id: string | null;
  client: DatabaseWorkerClient | null;
  status: DatabaseRuntimeStatus;
  killWorker: () => void;
  spawnWorker: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

function destroyRuntime(
  runtimeRef: RefObject<DatabaseRuntime | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  tearleads: Tearleads,
  setId: (value: string | null) => void,
  setClient: (value: DatabaseContextValue["client"]) => void,
  setStatus: (value: DatabaseRuntimeStatus) => void,
  nextStatus: DatabaseRuntimeStatus,
) {
  if (runtimeRef.current) {
    runtimeRef.current.destroy();
    runtimeRef.current = null;
  }

  bootingRef.current = false;
  currentDbNameRef.current = null;
  tearleads.db.clear(nextStatus);
  setId(null);
  setClient(null);
  setStatus(nextStatus);
}

async function bootDatabaseRuntime(
  runtime: DatabaseRuntime,
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

function configureSdkDatabaseRuntime(
  tearleads: Tearleads,
  runtime: DatabaseRuntime,
  status: DatabaseRuntimeStatus,
) {
  tearleads.db.configure({
    client: runtime.client,
    id: runtime.id,
    status,
  });
}

function completeDatabaseRuntimeBoot(params: {
  runtime: DatabaseRuntime;
  runtimeRef: RefObject<DatabaseRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  setStatus: (value: DatabaseRuntimeStatus) => void;
  dbName: string;
  log: (message: string) => void;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, setStatus, dbName, log } =
    params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  configureSdkDatabaseRuntime(tearleads, runtime, "ready");
  setStatus("ready");
  log(`Database initialized successfully: ${dbName}`);
  log("Worker spawned");
}

function failDatabaseRuntimeBoot(params: {
  runtime: DatabaseRuntime;
  runtimeRef: RefObject<DatabaseRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  setStatus: (value: DatabaseRuntimeStatus) => void;
  error: unknown;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, setStatus, error } =
    params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  console.error("Failed to initialize database worker:", error);
  configureSdkDatabaseRuntime(tearleads, runtime, "error");
  setStatus("error");
}

function useDestroyDatabaseRuntime(params: {
  runtimeRef: RefObject<DatabaseRuntime | null>;
  bootingRef: RefObject<boolean>;
  currentDbNameRef: RefObject<string | null>;
  tearleads: Tearleads;
  setId: (value: string | null) => void;
  setClient: (value: DatabaseContextValue["client"]) => void;
  setStatus: (value: DatabaseRuntimeStatus) => void;
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
    (nextStatus: DatabaseRuntimeStatus) => {
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

function useDatabaseRuntimeLifecycle(
  dbName: string | null,
  status: DatabaseRuntimeStatus,
  runtimeRef: RefObject<DatabaseRuntime | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  killedRef: RefObject<boolean>,
  destroyCurrentRuntime: (nextStatus: DatabaseRuntimeStatus) => void,
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

function useManagedDatabaseRuntime(
  createDatabaseRuntime: () => DatabaseRuntime,
  dbName: string | null,
  log: (message: string) => void,
  tearleads: Tearleads,
): DatabaseContextValue {
  const [status, setStatus] = useState<DatabaseRuntimeStatus>("idle");
  const [id, setId] = useState<string | null>(null);
  const [client, setClient] = useState<DatabaseContextValue["client"]>(null);
  const runtimeRef = useRef<DatabaseRuntime | null>(null);
  const bootingRef = useRef(false);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const destroyCurrentRuntime = useDestroyDatabaseRuntime({
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
      const runtime = createDatabaseRuntime();
      runtimeRef.current = runtime;
      configureSdkDatabaseRuntime(tearleads, runtime, "idle");
      setId(runtime.id);
      setClient(runtime.client);
      setStatus("idle");

      void bootDatabaseRuntime(runtime, dbName, log)
        .then(() => {
          completeDatabaseRuntimeBoot({
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
          failDatabaseRuntimeBoot({
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
      tearleads.db.clear("error");
      setStatus("error");
    }
  }, [createDatabaseRuntime, dbName, log, tearleads]);

  const killWorker = useCallback(() => {
    if (!runtimeRef.current) {
      return;
    }

    killedRef.current = true;
    destroyCurrentRuntime("terminated");
    log("Worker killed");
  }, [destroyCurrentRuntime, log]);

  useDatabaseRuntimeLifecycle(
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
  const { createDatabaseRuntime = createModuleDatabaseRuntime } =
    useAppHostConfig();
  const tearleads = useTearleads();
  const { log } = useLog();
  const { signingFingerprint } = useIdentity();
  const dbName =
    signingFingerprint === null
      ? null
      : `/app-identity-${signingFingerprint}.db`;
  const value = useManagedDatabaseRuntime(
    createDatabaseRuntime,
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
