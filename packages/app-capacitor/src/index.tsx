import { Capacitor } from "@capacitor/core";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import {
  createAppHostConfig,
  resolveEventsWebSocketUrl,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

function createCapacitorSQLiteRuntime() {
  const workerUrl = "./worker.js";
  return createSQLiteRuntime({ workerUrl });
}

const elem = document.getElementById("root");
if (!elem) throw new Error("Root element not found");

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
if (!apiBaseUrl) throw new Error("VITE_API_BASE_URL is not set");
const wsUrl = resolveEventsWebSocketUrl(
  apiBaseUrl,
  import.meta.env.VITE_WS_URL,
);

const hostConfig = createAppHostConfig({
  apiBaseUrl,
  createSQLiteRuntime: createCapacitorSQLiteRuntime,
  navigationMode: Capacitor.isNativePlatform() ? "routed" : undefined,
  wsUrl,
});

renderApp(createRoot(elem), { hostConfig });
