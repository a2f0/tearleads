import { renderApp } from "app/client";
import { AppHostConfig } from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

const apiBaseUrl =
  process.env.BUN_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const wsUrl = process.env.BUN_PUBLIC_WS_URL ?? "ws://localhost:3001";

if (import.meta.hot) {
  import.meta.hot.data.root ??= createRoot(elem);
  renderApp(import.meta.hot.data.root, {
    hostConfig: new AppHostConfig(apiBaseUrl, wsUrl),
  });
} else {
  renderApp(createRoot(elem), {
    hostConfig: new AppHostConfig(apiBaseUrl, wsUrl),
  });
}
