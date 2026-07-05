import { renderApp } from "app/client";
import {
  createAppHostConfig,
  resolveAppHostProfile,
  resolveEventsWebSocketUrl,
} from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";
import {
  prepareControllingServiceWorker,
  registerServiceWorkerAfterLoad,
} from "./serviceWorkerRegistration";
import { createWebPurchases } from "./webPurchases";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

const apiBaseUrl =
  process.env.BUN_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const wsUrl = resolveEventsWebSocketUrl(
  apiBaseUrl,
  process.env.BUN_PUBLIC_WS_URL,
);

const hostConfig = createAppHostConfig({
  apiBaseUrl,
  createPurchases: createWebPurchases,
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
