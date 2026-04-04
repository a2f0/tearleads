import {
  createContext,
  type PropsWithChildren,
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

export function DatabaseProvider({ children }: PropsWithChildren) {
  const { createWorker = createAppDatabaseWorker } = useAppHostConfig();
  const [status, setStatus] = useState<WorkerStatus>("idle");
  const [id, setId] = useState<string | null>(null);
  const [client, setClient] = useState<DatabaseContextValue["client"]>(null);
  const workerRef = useRef<AppDatabaseWorker | null>(null);
  const bootingRef = useRef(false);
  const currentDbNameRef = useRef<string | null>(null);
  const killedRef = useRef(false);
  const { log } = useLog();
  const { signingFingerprint } = usePersona();

  const dbName =
    signingFingerprint === null
      ? null
      : `/app-persona-${signingFingerprint}.db`;

  const destroyCurrentWorker = useCallback(
    (nextStatus: WorkerStatus) => {
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

      void appWorker.client
        .ping()
        .then(() => {
          if (workerRef.current !== appWorker) return;
          log("Loading SQLite3 WASM module...");
          log(`Initializing database: ${dbName}`);
          return appWorker.client.init({
            dbName,
            cipher: "chacha20",
            key: "development-key",
          });
        })
        .then(() => {
          if (workerRef.current === appWorker) {
            bootingRef.current = false;
            setStatus("ready");
            log(`Database initialized successfully: ${dbName}`);
            log("Worker spawned");
          }
        })
        .catch((error) => {
          if (workerRef.current === appWorker) {
            bootingRef.current = false;
            console.error("Failed to ping worker:", error);
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

    if (killedRef.current) {
      return;
    }

    if (!workerRef.current && !bootingRef.current) {
      spawnWorker();
    }
  }, [dbName, destroyCurrentWorker, spawnWorker, status]);

  useEffect(() => {
    return () => {
      destroyCurrentWorker("idle");
    };
  }, [destroyCurrentWorker]);

  return (
    <DatabaseContext.Provider
      value={{
        id,
        client,
        status,
        killWorker,
        spawnWorker,
      }}
    >
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
