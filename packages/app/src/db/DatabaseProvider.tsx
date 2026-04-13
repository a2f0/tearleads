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
import {
  type AppDatabaseWorker,
  createAppDatabaseWorker,
  type WorkerStatus,
} from "./sqliteWorker";

interface DatabaseContextValue {
  id: string | null;
  client: ReturnType<typeof createAppDatabaseWorker>["client"] | null;
  status: WorkerStatus;
  killWorker: () => void;
  spawnWorker: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

function destroyWorker(
  workerRef: RefObject<AppDatabaseWorker | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  setId: (value: string | null) => void,
  setClient: (value: DatabaseContextValue["client"]) => void,
  setStatus: (value: WorkerStatus) => void,
  nextStatus: WorkerStatus,
) {
  if (workerRef.current) {
    workerRef.current.client.destroy();
    workerRef.current.worker.terminate();
    workerRef.current = null;
  }

  bootingRef.current = false;
  currentDbNameRef.current = null;
  setId(null);
  setClient(null);
  setStatus(nextStatus);
}

async function bootDatabaseWorker(
  appWorker: AppDatabaseWorker,
  dbName: string,
  log: (message: string) => void,
) {
  log("Loading SQLite3 WASM module...");
  log(`Initializing database: ${dbName}`);
  await appWorker.client.init({
    dbName,
    cipher: "chacha20",
    key: "development-key",
  });
}

function useDatabaseWorkerLifecycle(
  dbName: string | null,
  status: WorkerStatus,
  workerRef: RefObject<AppDatabaseWorker | null>,
  bootingRef: RefObject<boolean>,
  currentDbNameRef: RefObject<string | null>,
  killedRef: RefObject<boolean>,
  destroyCurrentWorker: (nextStatus: WorkerStatus) => void,
  spawnWorker: () => void,
) {
  useEffect(() => {
    if (!dbName) {
      if (workerRef.current || status !== "idle") {
        destroyCurrentWorker("idle");
      }
      return;
    }

    if (currentDbNameRef.current !== dbName) {
      killedRef.current = false;
      destroyCurrentWorker("idle");
      spawnWorker();
      return;
    }

    if (!killedRef.current && !workerRef.current && !bootingRef.current) {
      spawnWorker();
    }
  }, [
    bootingRef,
    currentDbNameRef,
    dbName,
    destroyCurrentWorker,
    killedRef,
    spawnWorker,
    status,
    workerRef,
  ]);

  useEffect(() => {
    return () => {
      destroyCurrentWorker("idle");
    };
  }, [destroyCurrentWorker]);
}

function useManagedDatabaseWorker(
  createWorker: () => AppDatabaseWorker,
  dbName: string | null,
  log: (message: string) => void,
): DatabaseContextValue {
  const [status, setStatus] = useState<WorkerStatus>("idle");
  const [id, setId] = useState<string | null>(null);
  const [client, setClient] = useState<DatabaseContextValue["client"]>(null);
  const workerRef = useRef<AppDatabaseWorker | null>(null);
  const bootingRef = useRef(false);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const destroyCurrentWorker = useCallback(
    (nextStatus: WorkerStatus) => {
      destroyWorker(
        workerRef,
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

  const spawnWorker = useCallback(() => {
    if (!dbName || workerRef.current || bootingRef.current) {
      return;
    }
    killedRef.current = false;
    bootingRef.current = true;
    currentDbNameRef.current = dbName;

    try {
      const appWorker = createWorker();
      workerRef.current = appWorker;
      setId(appWorker.id);
      setClient(appWorker.client);
      setStatus("idle");

      void bootDatabaseWorker(appWorker, dbName, log)
        .then(() => {
          if (workerRef.current !== appWorker) return;
          bootingRef.current = false;
          setStatus("ready");
          log(`Database initialized successfully: ${dbName}`);
          log("Worker spawned");
        })
        .catch((error) => {
          if (workerRef.current === appWorker) {
            bootingRef.current = false;
            console.error("Failed to initialize database worker:", error);
            setStatus("error");
          }
        });
    } catch (error) {
      bootingRef.current = false;
      console.error("Failed to create database worker:", error);
      setStatus("error");
    }
  }, [createWorker, dbName, log]);

  const killWorker = useCallback(() => {
    if (!workerRef.current) {
      return;
    }

    killedRef.current = true;
    destroyCurrentWorker("terminated");
    log("Worker killed");
  }, [destroyCurrentWorker, log]);

  useDatabaseWorkerLifecycle(
    dbName,
    status,
    workerRef,
    bootingRef,
    currentDbNameRef,
    killedRef,
    destroyCurrentWorker,
    spawnWorker,
  );

  return {
    id,
    client,
    status,
    killWorker,
    spawnWorker,
  };
}

export function DatabaseProvider({ children }: PropsWithChildren) {
  const { createWorker = createAppDatabaseWorker } = useAppHostConfig();
  const { log } = useLog();
  const { signingFingerprint } = usePersona();
  const dbName =
    signingFingerprint === null
      ? null
      : `/app-persona-${signingFingerprint}.db`;
  const value = useManagedDatabaseWorker(createWorker, dbName, log);

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
