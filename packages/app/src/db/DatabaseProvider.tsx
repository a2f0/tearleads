import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  createAppDatabaseWorker,
  type AppDatabaseWorker,
  type WorkerStatus,
} from "./sqliteWorker";

export interface DatabaseContextValue {
  id: string | null;
  client: ReturnType<typeof createAppDatabaseWorker>["client"] | null;
  status: WorkerStatus;
  killWorker: () => void;
  spawnWorker: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

interface DatabaseProviderProps extends PropsWithChildren {
  createWorker?: typeof createAppDatabaseWorker;
}

export function DatabaseProvider({
  children,
  createWorker = createAppDatabaseWorker,
}: DatabaseProviderProps) {
  const [status, setStatus] = useState<WorkerStatus>("idle");
  const [id, setId] = useState<string | null>(null);
  const [client, setClient] = useState<DatabaseContextValue["client"]>(null);
  const workerRef = useRef<AppDatabaseWorker | null>(null);
  const killedRef = useRef(false);

  const spawnWorker = useCallback(() => {
    if (workerRef.current) {
      return;
    }
    killedRef.current = false;

    try {
      const appWorker = createWorker();
      workerRef.current = appWorker;
      setId(appWorker.id);
      setClient(appWorker.client);
      setStatus("idle");

      void appWorker.client
        .ping()
        .then(() => {
          if (workerRef.current === appWorker) {
            setStatus("ready");
          }
        })
        .catch((error) => {
          if (workerRef.current === appWorker) {
            console.error("Failed to ping worker:", error);
            setStatus("error");
          }
        });
    } catch (error) {
      console.error("Failed to create database worker:", error);
      setStatus("error");
    }
  }, [createWorker]);

  const killWorker = useCallback(() => {
    if (!workerRef.current) {
      return;
    }

    workerRef.current.client.destroy();
    workerRef.current.worker.terminate();
    workerRef.current = null;
    killedRef.current = true;
    setId(null);
    setClient(null);
    setStatus("terminated");
  }, []);

  // Spawn on mount only, not after intentional kill
  if (workerRef.current === null && status === "idle" && id === null && !killedRef.current) {
    spawnWorker();
  }

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
