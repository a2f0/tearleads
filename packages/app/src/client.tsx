import { StrictMode } from "react";
import type { Root } from "react-dom/client";
import { App } from "./App";
import type { createAppDatabaseWorker } from "./db/sqliteWorker";
import type { AppHostConfig } from "./host/AppHostConfig";

export interface RenderAppOptions {
  createWorker?: typeof createAppDatabaseWorker;
  hostConfig: AppHostConfig;
}

export function renderApp(root: Root, options: RenderAppOptions) {
  const app = options.createWorker ? (
    <App createWorker={options.createWorker} hostConfig={options.hostConfig} />
  ) : (
    <App hostConfig={options.hostConfig} />
  );

  root.render(<StrictMode>{app}</StrictMode>);
}
