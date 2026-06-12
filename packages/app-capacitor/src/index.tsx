import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import { AppHostConfig } from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

function createCapacitorSQLiteRuntime() {
  const workerUrl = new URL("./worker.js", import.meta.url);
  return createSQLiteRuntime({ workerUrl });
}

const elem = document.getElementById("root");
if (!elem) throw new Error("Root element not found");

renderApp(createRoot(elem), {
  hostConfig: new AppHostConfig(
    "http://localhost:3001",
    "ws://localhost:3001",
    createCapacitorSQLiteRuntime,
  ),
});
