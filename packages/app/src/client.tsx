import { StrictMode } from "react";
import type { Root } from "react-dom/client";
import { App } from "./App";
import type { AppHostConfig } from "./host/AppHostConfig";

export interface RenderAppOptions {
  hostConfig: AppHostConfig;
}

export function renderApp(root: Root, options: RenderAppOptions) {
  root.render(
    <StrictMode>
      <App hostConfig={options.hostConfig} />
    </StrictMode>,
  );
}
