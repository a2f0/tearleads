import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { createAppDatabaseWorker, type WorkerStatus } from "./sqliteWorker";

export interface DatabaseContextValue {
  client: ReturnType<typeof createAppDatabaseWorker>["client"] | null;
  status: WorkerStatus;
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
  const [client, setClient] = useState<DatabaseContextValue["client"]>(null);

  useEffect(() => {
    let isMounted = true;
    let appWorker: ReturnType<typeof createWorker> | undefined;

    try {
      appWorker = createWorker();
      setClient(appWorker.client);
    } catch (error) {
      console.error("Failed to create database worker:", error);
      setStatus("error");
      return;
    }

    void appWorker.client
      .ping()
      .then(() => {
        if (isMounted) {
          setStatus("ready");
        }
      })
      .catch((error) => {
        console.error("Failed to ping worker:", error);

        if (isMounted) {
          setStatus("error");
        }
      });

    return () => {
      isMounted = false;
      appWorker.client.destroy();
      appWorker.worker.terminate();
    };
  }, [createWorker]);

  return (
    <DatabaseContext.Provider
      value={{
        client,
        status,
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
