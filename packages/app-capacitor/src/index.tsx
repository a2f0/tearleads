import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  createSQLiteRuntime,
  PERSISTENT_STORAGE_POLICY,
} from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import {
  createAppBuildInfo,
  createAppHostConfig,
  resolveAppHostRuntimeConfig,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";
import { subscribeCapacitorConnectionRefresh } from "./capacitorConnectionRefresh";
import { createCapacitorFileSaver } from "./capacitorFileSaver";
import { createCapacitorFileViewer } from "./capacitorFileViewer";
import { subscribeCapacitorKeyboardVisibility } from "./capacitorKeyboardVisibility";
import { createCapacitorNetworkStatus } from "./capacitorNetworkStatus";
import { createCapacitorPurchases } from "./capacitorPurchases";
import { createCapacitorScanner } from "./capacitorScanner";
import { openCapacitorSubscriptionManagement } from "./capacitorSubscriptionManagement";
import { syncStatusBarWithTheme } from "./statusBar";

function createCapacitorSQLiteRuntime() {
  const workerUrl = "./worker.js";
  // Dedicated worker (not the cross-tab shared-owner coordinator). A Capacitor
  // WebView is a single tab, so cross-tab coordination buys nothing; and the
  // app reuses ONE dedicated worker across identity switches (see
  // AppHostConfig.reuseDatabaseWorker) by closing the current database and
  // re-initializing the same worker onto the next one — which requires a
  // dedicated worker (a cross-tab client's `close` stops the shared owner). This
  // avoids ever constructing a second worker, which fails on a WebView and
  // wedged provisioning of a second local identity.
  return createSQLiteRuntime({
    sharedWorkerConstructor: null,
    workerConstructor: globalThis.Worker,
    workerUrl,
  });
}

// The native build number (Android versionCode / iOS CFBundleVersion) is stamped
// into the native project by fastlane at release, not inlined into this bundle,
// so it is read at runtime from @capacitor/app rather than injected as build
// info. Only wired up under isNativePlatform(): App.getInfo() is unimplemented in
// the browser dev shell, where the Environment tab falls back to "unknown".
async function readNativeBuildNumber(): Promise<string> {
  const { build } = await App.getInfo();
  return build;
}

const elem = document.getElementById("root");
if (!elem) throw new Error("Root element not found");

// Shared across web/electrobun/capacitor via resolveAppHostRuntimeConfig; the
// VITE_ read stays here because only Vite inlines it. The bundle is byte-
// identical for capacitor debug and release, so a release aimed at a laptop
// (10.0.1.10:8085) is caught at build time by the store-release scripts
// (scripts/*Release.sh) and the fastlane server.url guard, not here.
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
  // Capacitor runs inside a WebView (Android System WebView / iOS WKWebView).
  // The default browser keyring persists its wrapping key as a live,
  // non-extractable CryptoKey via IndexedDB structured clone; a WKWebView cannot
  // do that without keychain access and throws DataCloneError, which takes down
  // keyring init (SQLite cipher key, identity persistence, crypto session) on
  // boot and leaves the app keyless — identity auto-provisioning silently fails
  // and every gated pane shows "Local keys required". Persist raw bytes instead
  // (the same fix the Electrobun shell uses, client-sdk #1185) so keyring init
  // works across both WebViews.
  //
  // Declared as a mode rather than by overriding createLocalKeyring: the
  // override made the keyring host-managed, which disabled PIN locking on
  // mobile ("Unavailable" in Identity Manager). The mode produces a
  // byte-identical wrapping-key record — same database, store, and provider —
  // so existing installs keep reading the keyring they already wrote.
  localKeyringKeyMaterialStorage: "raw-bytes",
  // The WebView has no browser download destination, so the default anchor
  // saver is a no-op; write the bytes and open the native share sheet instead.
  createFileSaver: createCapacitorFileSaver,
  createFileViewer: Capacitor.isNativePlatform()
    ? createCapacitorFileViewer
    : undefined,
  // Native connectivity via @capacitor/network — the Android WebView's
  // navigator.onLine reports offline while genuinely connected.
  createNetworkStatus: createCapacitorNetworkStatus,
  createPurchases: createCapacitorPurchases,
  createScanner: Capacitor.isNativePlatform()
    ? createCapacitorScanner
    : undefined,
  createSQLiteRuntime: createCapacitorSQLiteRuntime,
  navigationMode: Capacitor.isNativePlatform() ? "routed" : undefined,
  openSubscriptionManagement:
    Capacitor.getPlatform() === "ios"
      ? openCapacitorSubscriptionManagement
      : undefined,
  readNativeBuildNumber: Capacitor.isNativePlatform()
    ? readNativeBuildNumber
    : undefined,
  // Reuse one dedicated SQLite worker across identity switches instead of
  // tearing it down and constructing a new one (which fails on a WebView and
  // wedged provisioning of a second local identity).
  reuseDatabaseWorker: true,
  // Force OPFS persistence: iOS WKWebView does not expose
  // navigator.storage.getDirectory on the main thread, so the auto-detect path
  // would fall back to ephemeral memory storage. Android's Chromium WebView
  // already resolves to this, so it is a no-op there.
  storagePersistence: PERSISTENT_STORAGE_POLICY,
  subscribeConnectionRefresh: Capacitor.isNativePlatform()
    ? subscribeCapacitorConnectionRefresh
    : undefined,
  subscribeKeyboardVisibility: Capacitor.isNativePlatform()
    ? subscribeCapacitorKeyboardVisibility
    : undefined,
  wsUrl,
});

syncStatusBarWithTheme();

renderApp(createRoot(elem), { hostConfig });
