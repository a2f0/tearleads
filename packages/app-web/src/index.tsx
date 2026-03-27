import { renderApp } from "app/client";
import { createRoot } from "react-dom/client";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

if (import.meta.hot) {
  import.meta.hot.data.root ??= createRoot(elem);
  renderApp(import.meta.hot.data.root);
} else {
  renderApp(createRoot(elem));
}
