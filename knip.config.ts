import type { KnipConfig } from "knip";

const strictConfigDefaults = {
  treatConfigHintsAsErrors: true,
} as const;

const rootToolingWorkspace = {
  entry: [],
  project: [],
  // `markdownlint-cli2` is invoked as `bun --bun x markdownlint-cli2` so it runs
  // on Bun rather than an unpinned Node (its bin declares `engines.node >=22`,
  // and neither `.mise.toml` nor CI installs Node). Knip cannot resolve the
  // binary through `bun x`, so the dependency has to be declared used here.
  ignoreDependencies: ["@commitlint/cli", "lint-staged", "markdownlint-cli2"],
  ignoreBinaries: ["ansible-lint", "shellcheck"],
};

const capacitorNativePluginDependencies = [
  "@capacitor-community/sqlite",
  "@capacitor/ios",
  "@capawesome/capacitor-file-picker",
  "@capgo/capacitor-native-biometric",
];

const baseConfig = {
  ...strictConfigDefaults,
  workspaces: {
    ".": rootToolingWorkspace,
    "packages/agent-tool": {
      // `src/index.ts` is discovered as an entry via the package.json scripts.
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/api": {
      // The package test script launches Bun from `scripts/testAllDatabases.ts`;
      // `test/preload.ts` is loaded by Bun from `bunfig.toml`. Operator scripts
      // are standalone cron/systemd entrypoints rather than package scripts, so
      // they must be declared explicitly.
      entry: [
        "src/appTestRuntime.ts",
        "src/**/*.test.ts",
        "test/preload.ts",
        "scripts/blobGc.ts",
        "scripts/stripeSeatSync.ts",
      ],
      project: ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"],
    },
    "packages/api-client": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts", "test/**/*.ts"],
    },
    "packages/api-cli": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts", "scripts/**/*.ts"],
    },
    "packages/api-shared": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/app": {
      // The `screenshots:seed` CLI (test/screenshot-seed/buildScreenshotSeed.ts)
      // is auto-detected from the root package.json script; its sibling test is
      // declared here so knip does not flag it (it lives under test/, not src/).
      entry: ["src/**/*.test.{ts,tsx}", "test/screenshot-seed/**/*.test.ts"],
      project: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
      includeEntryExports: true,
    },
    "packages/app-web": {
      // `dev`/`start` launch devServer.ts through the scripts/withBuildInfoEnv.sh
      // wrapper, so knip can no longer discover it from the package.json script
      // and it must be declared explicitly.
      entry: [
        "src/index.tsx",
        "src/servers/devServer.ts",
        "src/servers/e2eServer.ts",
        "e2e/**/*.spec.ts",
        "screenshots/**/*.spec.ts",
      ],
      project: [
        "src/**/*.{ts,tsx}",
        "scripts/**/*.ts",
        "e2e/**/*.ts",
        "screenshots/**/*.ts",
      ],
      playwright: {
        config: ["playwright.config.ts", "playwright.screenshots.config.ts"],
        entry: ["e2e/**/*.spec.ts", "screenshots/**/*.spec.ts"],
      },
    },
    "packages/app-capacitor": {
      entry: ["scripts/buildWorker.ts"],
      project: ["scripts/**/*.ts", "src/**/*.{ts,tsx}"],
      ignoreDependencies: capacitorNativePluginDependencies,
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
        "src/data/trustedUserIdentity/testFixtures.ts",
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
    "packages/code-assist": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts", "scripts/**/*.ts"],
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
      project: ["scripts/**/*.ts", "src/**/*.ts"],
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
  ...strictConfigDefaults,
  // Keep production entries broad enough to validate runtime dependency
  // declarations without letting test reachability hide production drift.
  // The default config above stays narrower for dead-file and export checks.
  workspaces: {
    ".": rootToolingWorkspace,
    "packages/agent-tool": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/api": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts", "!src/appTestRuntime.ts"],
      project: [],
    },
    "packages/api-client": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts"],
      project: [],
    },
    "packages/api-cli": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts", "scripts/**/*.ts!"],
      project: [],
    },
    "packages/api-shared": {
      entry: ["src/**/*.ts!", "drizzle.config.ts!"],
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
    "packages/app-capacitor": {
      entry: ["capacitor.config.ts!", "src/**/*.{ts,tsx}!"],
      project: [],
      ignoreDependencies: [
        ...capacitorNativePluginDependencies,
        "@capacitor/core",
      ],
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
    "packages/code-assist": {
      entry: ["src/**/*.ts!", "!src/**/*.test.ts", "scripts/**/*.ts!"],
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

export const knipWorkspacePaths = {
  base: Object.keys(baseConfig.workspaces).filter(
    (workspacePath) => workspacePath !== ".",
  ),
  production: Object.keys(productionConfig.workspaces).filter(
    (workspacePath) => workspacePath !== ".",
  ),
} as const;

export default ((options) =>
  options.production ? productionConfig : baseConfig) satisfies KnipConfig;
