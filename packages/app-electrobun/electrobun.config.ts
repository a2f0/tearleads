import type { ElectrobunConfig } from "electrobun";

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
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/renderer/index.html",
        // Electrobun spreads a view's extra config into Bun.build, so this is
        // the same env inlining app-web gets from `bun build --env`, letting
        // both targets read build identity from `BUN_PUBLIC_*`. The vars are set
        // by scripts/withBuildInfoEnv.sh in the build/dev shell scripts.
        env: "BUN_PUBLIC_*",
      },
    },
  },
} satisfies ElectrobunConfig;
