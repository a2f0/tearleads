import { renderApp } from "app/client";
import { AppHostConfig } from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

const apiBaseUrl =
  process.env.BUN_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const wsUrl =
  process.env.BUN_PUBLIC_WS_URL ?? apiBaseUrl.replace(/^http/, "ws");

const hostConfig = new AppHostConfig(apiBaseUrl, wsUrl);

if (import.meta.hot) {
  import.meta.hot.data.root ??= createRoot(elem);
  renderApp(import.meta.hot.data.root, { hostConfig });
} else {
  renderApp(createRoot(elem), { hostConfig });
}

// Register the offline precache service worker outside of HMR (i.e. the built
// app, not `bun --hot` dev). `import.meta.hot` is the same prod/dev signal the
// render path above uses, and unlike a `process.env.NODE_ENV` check it survives
// the production build's define/minify pass. Registration is a progressive
// enhancement (it lets the app shell, the SQLite worker, and sqlite3.wasm load
// with no network), so it is best-effort and never blocks startup; where /sw.js
// is absent (e.g. the dynamic e2e server) the register call simply rejects.
if (
  !import.meta.hot &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator
) {
  const registerServiceWorker = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app works online without the service worker; only offline support is
      // lost if registration fails.
    });
  };

  // This module script may evaluate after `load` has already fired, in which case
  // the listener would never run — so register immediately when the document is
  // already complete, otherwise defer to `load` to avoid contending with startup.
  if (typeof document !== "undefined" && document.readyState === "complete") {
    registerServiceWorker();
  } else {
    globalThis.addEventListener("load", registerServiceWorker);
  }
}
