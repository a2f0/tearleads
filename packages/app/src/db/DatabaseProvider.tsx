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
  const killedRef = useRef(false);
  const { log } = useLog();

  const spawnWorker = useCallback(() => {
    if (workerRef.current || bootingRef.current) {
      return;
    }
    killedRef.current = false;
    bootingRef.current = true;

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
          log("Initializing database: /app.db");
          return appWorker.client.init({
            dbName: "/app.db",
            cipher: "chacha20",
            key: "development-key",
          });
        })
        .then(() => {
          if (workerRef.current === appWorker) {
            bootingRef.current = false;
            setStatus("ready");
            log("Database initialized successfully: /app.db");
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
  }, [createWorker, log]);

  const killWorker = useCallback(() => {
    if (!workerRef.current) {
      return;
    }

    workerRef.current.client.destroy();
    workerRef.current.worker.terminate();
    workerRef.current = null;
    bootingRef.current = false;
    killedRef.current = true;
    setId(null);
    setClient(null);
    setStatus("terminated");
    log("Worker killed");
  }, [log]);

  useEffect(() => {
    spawnWorker();
    return () => {
      bootingRef.current = false;
      if (workerRef.current) {
        workerRef.current.client.destroy();
        workerRef.current.worker.terminate();
        workerRef.current = null;
      }
    };
  }, [spawnWorker]);

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
