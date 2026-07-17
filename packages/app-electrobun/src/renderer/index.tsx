import { createWebViewLocalKeyring } from "@tearleads/client-sdk";
import {
  createSQLiteRuntime,
  PERSISTENT_STORAGE_POLICY,
} from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import {
  APP_HOST_PROFILES,
  createAppBuildInfo,
  createAppHostConfig,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

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

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

renderApp(createRoot(elem), {
  hostConfig: createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    // Stamped by scripts/withBuildInfoEnv.sh and inlined by the `env` passthrough
    // this view declares in electrobun.config.ts.
    buildInfo: createAppBuildInfo({
      commit: process.env.BUN_PUBLIC_GIT_SHA,
      target: "electrobun",
      version: process.env.BUN_PUBLIC_APP_VERSION,
    }),
    // WKWebView cannot structured-clone a non-extractable CryptoKey into
    // IndexedDB (the default browser keyring) without keychain access, which an
    // unsigned dev app lacks; use the raw-bytes WebView keyring so keyring init
    // (SQLite cipher key, identity persistence, crypto session) works on boot.
    createLocalKeyring: () => createWebViewLocalKeyring(),
    createSQLiteRuntime: createElectrobunSQLiteRuntime,
    profile: APP_HOST_PROFILES.app,
    // Electrobun has OPFS in its worker, but WKWebView does not expose
    // navigator.storage.getDirectory on the renderer main thread. The default
    // auto-detect path would fall back to ephemeral memory storage.
    storagePersistence: PERSISTENT_STORAGE_POLICY,
    wsUrl: "ws://localhost:3001",
  }),
});
