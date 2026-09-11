import type { ElectrobunConfig } from "electrobun";
import { createRendererEnvironmentDefines } from "./src/rendererEnvironment";

export default {
  app: {
    name: "Tearleads",
    identifier: "com.tearleads.app",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    mac: {
      bundleCEF: false,
      defaultRenderer: "native",
    },
    win: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    linux: {
      // Electrobun's WebKitGTK worker does not reliably expose the OPFS APIs
      // required by SQLite's SyncAccessHandle Pool VFS. Use the bundled Chromium
      // renderer so Linux keeps the encrypted, persistent database contract.
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/renderer/index.html",
        // Hutch's bundler uses explicit defines for the existing public build
        // environment supplied by scripts/withBuildInfoEnv.sh.
        define: createRendererEnvironmentDefines(process.env),
      },
    },
  },
} satisfies ElectrobunConfig;
