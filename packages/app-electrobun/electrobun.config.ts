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
      },
    },
  },
} satisfies ElectrobunConfig;
