import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import {
  APP_HOST_PROFILES,
  type AppHostProfile,
  createAppHostConfig,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    readonly __TEARLEADS_ELECTROBUN_DEV__?: boolean;
  }
}

function createElectrobunSQLiteRuntime() {
  const workerUrl =
    location.protocol === "http:"
      ? "/worker.js"
      : new URL("./worker.js", import.meta.url);

  return createSQLiteRuntime({
    // Electrobun is a single desktop webview; use the dedicated worker path and
    // avoid SharedWorker coordination that is meant for multi-tab browsers.
    sharedWorkerConstructor: null,
    workerUrl,
  });
}

function withManualIdentity(profile: AppHostProfile): AppHostProfile {
  return {
    ...profile,
    features: {
      ...profile.features,
      autoGenerateIdentity: false,
      autoRegisterIdentity: false,
    },
  };
}

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

const profile =
  window.__TEARLEADS_ELECTROBUN_DEV__ === true
    ? // Boot-time identity autopilot currently trips a native Electrobun/Bun
      // segfault in dev. Keep the shell usable while that crash path is isolated.
      withManualIdentity(APP_HOST_PROFILES.app)
    : APP_HOST_PROFILES.app;

renderApp(createRoot(elem), {
  hostConfig: createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    createSQLiteRuntime: createElectrobunSQLiteRuntime,
    profile,
    wsUrl: "ws://localhost:3001",
  }),
});
