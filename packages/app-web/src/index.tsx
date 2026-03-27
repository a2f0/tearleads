import { renderApp } from "app/client";
import { AppHostConfig } from "app/host/AppHostConfig";
import { createRoot } from "react-dom/client";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

if (import.meta.hot) {
  import.meta.hot.data.root ??= createRoot(elem);
  renderApp(import.meta.hot.data.root, {
    hostConfig: new AppHostConfig(
      "http://localhost:3001",
      "ws://localhost:3001",
    ),
  });
} else {
  renderApp(createRoot(elem), {
    hostConfig: new AppHostConfig(
      "http://localhost:3001",
      "ws://localhost:3001",
    ),
  });
}
