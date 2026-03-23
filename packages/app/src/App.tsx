import { useEffect, useState } from "react";
import { createAppDatabaseWorker, type WorkerStatus } from "./db/sqliteWorker";

export function App() {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("idle");

  useEffect(() => {
    const client = createAppDatabaseWorker();

    void client
      .ping()
      .then(() => {
        setWorkerStatus("ready");
      })
      .catch(() => {
        setWorkerStatus("error");
      });
  }, []);

  return <div>App worker: {workerStatus}</div>;
}
