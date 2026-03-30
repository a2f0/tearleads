import type { KnipConfig } from "knip";

export default {
  workspaces: {
    ".": {
      entry: [],
      project: [],
      ignoreDependencies: [
        "@tearleads/api-client",
        "app",
        "lint-staged",
        "madge",
      ],
    },
    "packages/api": {
      entry: ["src/**/*.test.ts", "test/**/*.test.ts"],
      project: ["src/**/*.ts", "test/**/*.ts"],
    },
    "packages/api-client": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/app": {
      entry: ["src/**/*.test.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    },
    "packages/app-web": {
      entry: ["src/index.tsx", "src/servers/e2eServer.ts", "e2e/**/*.spec.ts"],
      project: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
      playwright: {
        config: ["playwright.config.ts"],
        entry: ["e2e/**/*.spec.ts"],
      },
    },
    "packages/app-electrobun": {
      entry: [
        "electrobun.config.ts",
        "src/bun/index.ts",
        "src/renderer/index.tsx",
        "src/renderer/sqliteWorker.ts",
      ],
      project: ["src/**/*.{ts,tsx}"],
    },
    "packages/crypto": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/validators": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/sqlite-instance": {
      entry: [],
      project: ["src/**/*.ts"],
    },
    "packages/sqlite-worker": {
      entry: ["tests/**/*.test.ts"],
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
  },
} satisfies KnipConfig;
