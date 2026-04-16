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
import { useLog } from "../logging/LogProvider";
import { usePersona } from "../persona/PersonaProvider";

type DatabaseRuntimeStatus = "idle" | "ready" | "error" | "terminated";

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
): DatabaseContextValue {
  const [status, setStatus] = useState<DatabaseRuntimeStatus>("idle");
  const [id, setId] = useState<string | null>(null);
  const [client, setClient] = useState<DatabaseContextValue["client"]>(null);
  const runtimeRef = useRef<DatabaseRuntime | null>(null);
  const bootingRef = useRef(false);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const destroyCurrentRuntime = useCallback(
    (nextStatus: DatabaseRuntimeStatus) => {
      destroyRuntime(
        runtimeRef,
        bootingRef,
        currentDbNameRef,
        setId,
        setClient,
        setStatus,
        nextStatus,
      );
    },
    [setClient, setId, setStatus],
  );

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
      setId(runtime.id);
      setClient(runtime.client);
      setStatus("idle");

      void bootDatabaseRuntime(runtime, dbName, log)
        .then(() => {
          if (runtimeRef.current !== runtime) {
            return;
          }

          bootingRef.current = false;
          setStatus("ready");
          log(`Database initialized successfully: ${dbName}`);
          log("Worker spawned");
        })
        .catch((error) => {
          if (runtimeRef.current !== runtime) {
            return;
          }

          bootingRef.current = false;
          console.error("Failed to initialize database worker:", error);
          setStatus("error");
        });
    } catch (error) {
      bootingRef.current = false;
      console.error("Failed to create database worker:", error);
      setStatus("error");
    }
  }, [createDatabaseRuntime, dbName, log]);

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
  const { log } = useLog();
  const { signingFingerprint } = usePersona();
  const dbName =
    signingFingerprint === null
      ? null
      : `/app-persona-${signingFingerprint}.db`;
  const value = useManagedDatabaseRuntime(createDatabaseRuntime, dbName, log);

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
