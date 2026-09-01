import {
  createSQLiteRuntime,
  PERSISTENT_STORAGE_POLICY,
} from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import {
  APP_HOST_PROFILES,
  createAppBuildInfo,
  createAppHostConfig,
  resolveAppHostRuntimeConfig,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";
import { createElectrobunFileSaver } from "./electrobunFileSaver";

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

// Shared with web/capacitor via resolveAppHostRuntimeConfig. Defaults to
// localhost:3001 when unset (the desktop dev shell's usual target); reads
// BUN_PUBLIC_API_BASE_URL so a packaged build can point elsewhere, which the
// old hardcoded URL could not.
const { apiBaseUrl, wsUrl } = resolveAppHostRuntimeConfig({
  apiBaseUrl: process.env.BUN_PUBLIC_API_BASE_URL,
  wsUrl: process.env.BUN_PUBLIC_WS_URL,
});

renderApp(createRoot(elem), {
  hostConfig: createAppHostConfig({
    apiBaseUrl,
    // Stamped by scripts/withBuildInfoEnv.sh and inlined by the `env` passthrough
    // this view declares in electrobun.config.ts.
    buildInfo: createAppBuildInfo({
      commit: process.env.BUN_PUBLIC_GIT_SHA,
      target: "electrobun",
      version: process.env.BUN_PUBLIC_APP_VERSION,
    }),
    // WKWebView cannot structured-clone a non-extractable CryptoKey into
    // IndexedDB (the default browser keyring) without keychain access, which an
    // unsigned dev app lacks; persist raw bytes so keyring init (SQLite cipher
    // key, identity persistence, crypto session) works on boot.
    //
    // Declared as a mode rather than by overriding createLocalKeyring, which
    // would make the keyring host-managed and disable PIN locking. The record
    // written is byte-identical, so existing installs are unaffected.
    localKeyringKeyMaterialStorage: "raw-bytes",
    // The desktop WKWebView has no browser download destination; route the
    // download through the Bun main process, which writes to ~/Downloads.
    createFileSaver: createElectrobunFileSaver,
    createSQLiteRuntime: createElectrobunSQLiteRuntime,
    profile: APP_HOST_PROFILES.app,
    // Electrobun is also a single WKWebView backed by one dedicated worker.
    // Reinitialize that worker across identity switches instead of constructing
    // a replacement, which has the same WebKit worker-startup failure mode as
    // Capacitor's iOS shell.
    reuseDatabaseWorker: true,
    // Electrobun has OPFS in its worker, but WKWebView does not expose
    // navigator.storage.getDirectory on the renderer main thread. The default
    // auto-detect path would fall back to ephemeral memory storage.
    storagePersistence: PERSISTENT_STORAGE_POLICY,
    wsUrl,
  }),
});
