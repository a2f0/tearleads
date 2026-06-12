import { createBrowserLocalKeyring } from "@tearleads/client-sdk";
import { renderApp } from "app/client";
import { AppHostConfig } from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

const rawEnv = typeof process !== "undefined" && process.env ? process.env : {};

// biome-ignore lint/complexity/useLiteralKeys: bracket notation required by noPropertyAccessFromIndexSignature
const apiBaseUrl = rawEnv["BUN_PUBLIC_API_BASE_URL"] ?? "http://localhost:3001";
// biome-ignore lint/complexity/useLiteralKeys: bracket notation required by noPropertyAccessFromIndexSignature
const wsUrl = rawEnv["BUN_PUBLIC_WS_URL"] ?? apiBaseUrl.replace(/^http/, "ws");

const hostConfig = new AppHostConfig(
  apiBaseUrl,
  wsUrl,
  undefined,
  undefined,
  undefined,
  () => createBrowserLocalKeyring(),
);

if (import.meta.hot) {
  import.meta.hot.data.root ??= createRoot(elem);
  renderApp(import.meta.hot.data.root, { hostConfig });
} else {
  renderApp(createRoot(elem), { hostConfig });
}
