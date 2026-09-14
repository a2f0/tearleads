import type { ElectrobunConfig } from "electrobun";
import { createRendererEnvironmentDefines } from "./src/rendererEnvironment";

const { ELECTROBUN_RELEASE_TIER: releaseTier } = process.env;

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
      // macOS uses its built-in WKWebView.
      bundleCEF: false,
      defaultRenderer: "native",
      codesign: Boolean(releaseTier),
      notarize: Boolean(releaseTier),
      ...(releaseTier ? { icons: "build/release-icons/icon.iconset" } : {}),
      entitlements: {
        // Hutch also emits NSCameraUsageDescription for this entitlement.
        "com.apple.security.device.camera": true,
      },
    },
    artifactFolder: "build/artifacts",
    win: {
      // Pin Chromium to the app release, independently of the machine's
      // WebView2 installation and update cycle.
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    linux: {
      ...(releaseTier ? { icon: "build/release-icons/icon.png" } : {}),
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
  scripts: {
    postBuild: "scripts/postBuild.ts",
  },
  release: {
    baseUrl:
      releaseTier === "staging"
        ? "https://s3.us-east-1.amazonaws.com/downloads-staging.tearleads.com"
        : "https://s3.us-east-1.amazonaws.com/downloads.tearleads.com",
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
