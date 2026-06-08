import type { KnipConfig } from "knip";

const baseConfig = {
  treatConfigHintsAsErrors: true,
  workspaces: {
    ".": {
      entry: [],
      project: [],
      ignoreDependencies: ["@commitlint/cli", "lint-staged"],
    },
    "packages/api": {
      // `test/preload.ts` is discovered from bunfig.toml. There are no
      // standalone `test/**/*.test.ts` files; `test/**/*.ts` stays in project so
      // helper modules are still checked when reached from source tests.
      entry: ["src/appTestRuntime.ts", "src/**/*.test.ts"],
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
        "src/renderer/databaseWorker.ts",
      ],
      project: ["src/**/*.{ts,tsx}"],
    },
    "packages/bob-and-alice": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/client-sdk": {
      // Package exports point at dist, so list the source facades that feed the
      // build and public API contract explicitly.
      entry: [
        "src/index.ts",
        "src/documents.ts",
        "src/sqlite.ts",
        "src/stores/container-contents/index.ts",
        "src/stores/documents/index.ts",
        "src/workflows/blobs/index.ts",
        "src/workflows/containers/index.ts",
        "src/workflows/documents/index.ts",
        "src/workflows/container-contents/index.ts",
        "src/workflows/organizations/index.ts",
        "src/workflows/principals/index.ts",
        "src/workflows/registration/index.ts",
        "src/workflows/sync/index.ts",
      ],
      project: ["src/**/*.ts", "test/**/*.ts"],
    },
    "packages/crypto": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/encoding": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/loro": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/ui": {
      project: ["src/**/*.{ts,tsx}"],
    },
    "packages/validators": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/website": {
      entry: ["src/pages/**/*.astro"],
      project: ["src/**/*.{astro,ts,tsx}"],
    },
    "packages/sqlite-instance": {
      entry: [],
      project: ["src/**/*.ts"],
    },
    "packages/sqlite-worker": {
      entry: ["tests/**/*.test.ts"],
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
    "packages/test-utils": {
      // Knip discovers the public entry from package.json exports.
      project: ["src/**/*.ts"],
    },
  },
} satisfies KnipConfig;

const productionConfig = {
  treatConfigHintsAsErrors: true,
  // Keep production entries broad enough to validate runtime dependency
  // declarations without letting test reachability hide production drift.
  // The default config above stays narrower for dead-file and export checks.
  workspaces: {
    ".": {
      entry: [],
      project: [],
      ignoreDependencies: ["@commitlint/cli", "lint-staged"],
    },
    "packages/api": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts", "!src/appTestRuntime.ts"],
      project: [],
    },
    "packages/api-client": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/app": {
      entry: [
        "src/**/*.{ts,tsx}!",
        "!src/**/*.test.{ts,tsx}",
        "!src/**/testUtils.{ts,tsx}",
      ],
      project: [],
    },
    "packages/app-web": {
      entry: ["src/**/*.{ts,tsx}!", "!src/servers/e2eServer.ts"],
      project: [],
    },
    "packages/app-electrobun": {
      entry: ["electrobun.config.ts!", "src/**/*.{ts,tsx}!"],
      project: [],
    },
    "packages/bob-and-alice": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/client-sdk": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/crypto": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/encoding": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/loro": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/ui": {
      entry: ["src/**/*.{ts,tsx}!"],
      project: [],
    },
    "packages/validators": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/website": {
      entry: ["astro.config.ts!", "src/**/*.{astro,ts,tsx}!"],
      project: [],
      ignoreDependencies: ["@astrojs/react", "react-dom"],
    },
    "packages/sqlite-instance": {
      entry: ["src/**/*.ts!"],
      project: [],
    },
    "packages/sqlite-worker": {
      entry: ["src/**/*.ts!"],
      project: [],
    },
    "packages/test-utils": {
      entry: ["src/**/*.ts!"],
      project: [],
    },
  },
} satisfies KnipConfig;

export default ((options: { production?: boolean }) =>
  options.production ? productionConfig : baseConfig) satisfies KnipConfig;
