import { Capacitor } from "@capacitor/core";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import {
  createAppBuildInfo,
  createAppHostConfig,
  resolveAppHostRuntimeConfig,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";
import { createCapacitorPurchases } from "./capacitorPurchases";
import { syncStatusBarWithTheme } from "./statusBar";

function createCapacitorSQLiteRuntime() {
  const workerUrl = "./worker.js";
  return createSQLiteRuntime({ workerUrl });
}

const elem = document.getElementById("root");
if (!elem) throw new Error("Root element not found");

// Shared across web/electrobun/capacitor via resolveAppHostRuntimeConfig; the
// VITE_ read stays here because only Vite inlines it. The bundle is byte-
// identical for capacitor debug and release, so a release aimed at a laptop
// (10.0.1.10:8085) is caught at build time by uploadAndroidRelease.sh and the
// fastlane server.url guard, not here.
const { apiBaseUrl, wsUrl } = resolveAppHostRuntimeConfig({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  wsUrl: import.meta.env.VITE_WS_URL,
});

const hostConfig = createAppHostConfig({
  apiBaseUrl,
  // Resolved and inlined by the `define` block in vite.config.ts.
  buildInfo: createAppBuildInfo({
    commit: import.meta.env.VITE_GIT_SHA,
    target: "capacitor",
    version: import.meta.env.VITE_APP_VERSION,
  }),
  createPurchases: createCapacitorPurchases,
  createSQLiteRuntime: createCapacitorSQLiteRuntime,
  navigationMode: Capacitor.isNativePlatform() ? "routed" : undefined,
  wsUrl,
});

syncStatusBarWithTheme();

renderApp(createRoot(elem), { hostConfig });
