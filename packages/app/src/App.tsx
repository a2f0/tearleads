import { useEffect, useState } from "react";
import { createAppDatabaseWorker, type WorkerStatus } from "./db/sqliteWorker";

interface AppProps {
  createWorker?: typeof createAppDatabaseWorker;
}

export function App({ createWorker = createAppDatabaseWorker }: AppProps) {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("idle");

  useEffect(() => {
    let isMounted = true;
    let appWorker: ReturnType<typeof createWorker> | undefined;

    try {
      appWorker = createWorker();
    } catch (error) {
      console.error("Failed to create database worker:", error);
      setWorkerStatus("error");
      return;
    }

    void appWorker.client
      .ping()
      .then(() => {
        if (isMounted) {
          setWorkerStatus("ready");
        }
      })
      .catch((error) => {
        console.error("Failed to ping worker:", error);

        if (isMounted) {
          setWorkerStatus("error");
        }
      });

    return () => {
      isMounted = false;
      appWorker.client.destroy();
      appWorker.worker.terminate();
    };
  }, []);

  return <div>App worker: {workerStatus}</div>;
}
