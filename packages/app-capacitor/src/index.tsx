import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { PERSISTENT_STORAGE_POLICY } from "@tearleads/client-sdk/sqlite";
import { renderApp } from "app/client";
import {
  createAppBuildInfo,
  createAppHostConfig,
  resolveAppHostRuntimeConfig,
} from "app/host/AppHostConfig";
import { createTelemetryConsent } from "app/host/telemetryConsent";
import { createRoot } from "react-dom/client";
import { createCapacitorPurchases } from "./billing/capacitorPurchases";
import { openCapacitorSubscriptionManagement } from "./billing/capacitorSubscriptionManagement";
import { createCapacitorSQLiteRuntime } from "./database/capacitorSQLiteRuntime";
import { subscribeCapacitorConnectionRefresh } from "./device/capacitorConnectionRefresh";
import { subscribeCapacitorKeyboardVisibility } from "./device/capacitorKeyboardVisibility";
import { createCapacitorNetworkStatus } from "./device/capacitorNetworkStatus";
import { createNativePasswordKeychain } from "./device/capacitorPasswordKeychain";
import { createCapacitorScanner } from "./device/capacitorScanner";
import { syncStatusBarWithTheme } from "./device/statusBar";
import { configureNativeSentry } from "./diagnostics/sentry";
import { deleteStagedNativeFiles } from "./files/capacitorCacheFile";
import { createCapacitorFileSaver } from "./files/capacitorFileSaver";
import { createCapacitorFileViewer } from "./files/capacitorFileViewer";

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
// VITE_ read stays here because only Vite inlines it. A release aimed at a laptop
// (10.0.1.10:8085) is caught at build time by the store-release scripts
// (scripts/release/*Release.sh) and the fastlane server.url guard, not here.
const { apiBaseUrl, wsUrl } = resolveAppHostRuntimeConfig({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  wsUrl: import.meta.env.VITE_WS_URL,
});

// Error reports follow the user's anonymous-telemetry opt-in, which starts off.
const telemetryConsent = createTelemetryConsent();
const hostConfig = createAppHostConfig({
  apiBaseUrl,
  diagnostics: await configureNativeSentry(telemetryConsent),
  telemetryConsent,
  // Resolved and inlined by vite.config.ts.
  buildInfo: createAppBuildInfo({
    commit: import.meta.env.VITE_GIT_SHA,
    packageVersionsJson: import.meta.env.VITE_PACKAGE_VERSIONS,
    target: "capacitor",
    version: import.meta.env.VITE_APP_VERSION,
  }),
  // A device reset also removes files staged natively, outside WebView
  // storage: decrypted share and preview copies and camera captures. The
  // browser dev shell's Filesystem lives in IndexedDB, which the reset clears.
  clearNativeCache: Capacitor.isNativePlatform()
    ? deleteStagedNativeFiles
    : undefined,
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
  // Neither native WebView implements window.print(), so a print action would
  // silently do nothing; the share sheet a download opens offers Print.
  disablePrinting: Capacitor.isNativePlatform(),
  // The WebView has no browser download destination, so the default anchor
  // saver is a no-op; write the bytes and open the native share sheet instead.
  createFileSaver: createCapacitorFileSaver,
  createFileViewer: Capacitor.isNativePlatform()
    ? createCapacitorFileViewer
    : undefined,
  // Native connectivity via @capacitor/network — the Android WebView's
  // navigator.onLine reports offline while genuinely connected.
  createNetworkStatus: createCapacitorNetworkStatus,
  // Google Password Manager through Credential Manager on Android, and iCloud
  // Keychain on iOS for the domain the build's entitlement associates.
  createPasswordKeychain: Capacitor.isNativePlatform()
    ? createNativePasswordKeychain
    : undefined,
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
  probeApiNetworkFailures: true,
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
