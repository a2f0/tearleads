import { StrictMode } from "react";
import type { Root } from "react-dom/client";
import { App } from "./App";
import type { createAppDatabaseWorker } from "./db/sqliteWorker";

export interface RenderAppOptions {
  createWorker?: typeof createAppDatabaseWorker;
}

export function renderApp(root: Root, options: RenderAppOptions = {}) {
  const app = options.createWorker ? (
    <App createWorker={options.createWorker} />
  ) : (
    <App />
  );

  root.render(<StrictMode>{app}</StrictMode>);
}
