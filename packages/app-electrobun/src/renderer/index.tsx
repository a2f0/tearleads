import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import { renderApp } from "app/client";
import { createModuleWorker } from "app/db/createModuleWorker";
import type { AppDatabaseWorker } from "app/db/sqliteWorker";
import { createRoot } from "react-dom/client";

function createElectrobunDatabaseWorker(): AppDatabaseWorker {
  const worker = createModuleWorker(
    new URL("../../../app/src/db/sqliteWorkerThread.ts", import.meta.url),
  );

  return {
    id: crypto.randomUUID(),
    client: createDatabaseWorkerClient(worker),
    worker,
  };
}

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

renderApp(createRoot(elem), {
  createWorker: createElectrobunDatabaseWorker,
});
