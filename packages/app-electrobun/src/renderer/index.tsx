import { createModuleDatabaseRuntime } from "@tearleads/sqlite-worker/runtime";
import { renderApp } from "app/client";
import { AppHostConfig } from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

function createElectrobunDatabaseRuntime() {
  const workerUrl =
    location.protocol === "http:"
      ? "/worker.js"
      : new URL("./databaseWorker.ts", import.meta.url);

  return createModuleDatabaseRuntime({ workerUrl });
}

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

renderApp(createRoot(elem), {
  hostConfig: new AppHostConfig(
    "http://localhost:3001",
    "ws://localhost:3001",
    createElectrobunDatabaseRuntime,
  ),
});
