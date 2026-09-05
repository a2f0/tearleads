import { renderApp } from "app/client";
import {
  createAppBuildInfo,
  createAppHostConfig,
  resolveAppHostProfile,
  resolveAppHostRuntimeConfig,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";
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

const hostConfig = createAppHostConfig({
  apiBaseUrl,
  // Stamped by scripts/withBuildInfoEnv.sh and inlined by `bun build --env`.
  buildInfo: createAppBuildInfo({
    commit: process.env.BUN_PUBLIC_GIT_SHA,
    target: "web",
    version: process.env.BUN_PUBLIC_APP_VERSION,
  }),
  createDirectCheckout: createWebDirectCheckout,
  wsUrl,
  profile: resolveAppHostProfile(process.env.BUN_PUBLIC_APP_VARIANT),
});

await prepareControllingServiceWorker();

if (import.meta.hot) {
  import.meta.hot.data.root ??= createRoot(elem);
  renderApp(import.meta.hot.data.root, { hostConfig });
} else {
  renderApp(createRoot(elem), { hostConfig });
}

registerServiceWorkerAfterLoad();
