import { renderApp } from "app/client";
import {
  browserPasswordKeychainFactory,
  createAppBuildInfo,
  createAppHostConfig,
  resolveAppHostProfile,
  resolveAppHostRuntimeConfig,
} from "app/host/AppHostConfig";
import { createTelemetryConsent } from "app/host/telemetryConsent";
import { createRoot } from "react-dom/client";
import { initializeClickTracking } from "./clickTracking";
import { configureSentry } from "./diagnostics/sentry";
import {
  prepareControllingServiceWorker,
  registerServiceWorkerAfterLoad,
} from "./serviceWorkerRegistration";
import { createWebDirectCheckout } from "./webDirectCheckout";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

const { apiBaseUrl, wsUrl } = resolveAppHostRuntimeConfig({
  apiBaseUrl: process.env.BUN_PUBLIC_API_BASE_URL,
  wsUrl: process.env.BUN_PUBLIC_WS_URL,
});

// Every collector below follows the user's opt-in, which starts off.
const telemetryConsent = createTelemetryConsent();
const diagnostics = configureSentry(
  {
    dsn: process.env.BUN_PUBLIC_SENTRY_DSN,
    environment: process.env.BUN_PUBLIC_SENTRY_ENVIRONMENT,
    commit: process.env.BUN_PUBLIC_SENTRY_COMMIT,
    variant: process.env.BUN_PUBLIC_APP_VARIANT,
    origin: window.location.origin,
    scriptUrl: import.meta.url,
  },
  telemetryConsent,
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void diagnostics?.dispose();
  });

const hostConfig = createAppHostConfig({
  diagnostics,
  apiBaseUrl,
  // Stamped by scripts/lib/withBuildInfoEnv.sh and inlined by `bun build --env`.
  buildInfo: createAppBuildInfo({
    commit: process.env.BUN_PUBLIC_GIT_SHA,
    packageVersionsJson: process.env.BUN_PUBLIC_PACKAGE_VERSIONS,
    target: "web",
    version: process.env.BUN_PUBLIC_APP_VERSION,
  }),
  createDirectCheckout: createWebDirectCheckout,
  // Chromium browsers can save a recovery key to their password manager when
  // the user asks, and fill it back in on restore; others have no
  // PasswordCredential, so they offer neither.
  createPasswordKeychain: browserPasswordKeychainFactory(),
  navigationMode:
    process.env.BUN_PUBLIC_NAVIGATION_MODE === "windowed"
      ? "windowed"
      : undefined,
  probeApiNetworkFailures: true,
  wsUrl,
  profile: resolveAppHostProfile(process.env.BUN_PUBLIC_APP_VARIANT),
  telemetryConsent,
});

await prepareControllingServiceWorker();

if (import.meta.hot) {
  import.meta.hot.data.root ??= createRoot(elem);
  renderApp(import.meta.hot.data.root, { hostConfig });
} else {
  renderApp(createRoot(elem), { hostConfig });
}

registerServiceWorkerAfterLoad();
initializeClickTracking(
  process.env.NODE_ENV === "production",
  telemetryConsent,
);
