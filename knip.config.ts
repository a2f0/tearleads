import type { KnipConfig } from "knip";

const strictConfigDefaults = {
  treatConfigHintsAsErrors: true,
  // Types used in exported signatures must remain nameable in declaration emit.
  ignoreExportsUsedInFile: { interface: true, type: true },
} as const;

const rootToolingWorkspace = {
  entry: [],
  project: [],
  // `markdownlint-cli2` is invoked as `bun --bun x markdownlint-cli2` so it runs
  // on Bun rather than an unpinned Node (its bin declares `engines.node >=22`,
  // and neither `.mise.toml` nor CI installs Node). Knip cannot resolve the
  // binary through `bun x`, so the dependency has to be declared used here.
  ignoreDependencies: ["@commitlint/cli", "lint-staged", "markdownlint-cli2"],
  ignoreBinaries: ["ansible-lint", "du", "shellcheck", "tokei"],
};

const capacitorNativePluginDependencies = [
  "@capacitor-community/sqlite",
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
      // Knip's Bun plugin discovers `test/preload.ts` via `bunfig.toml`. Operator scripts
      // are standalone cron/systemd entrypoints rather than package scripts, so
      // they must be declared explicitly.
      entry: [
        "src/appTestRuntime.ts",
        "src/**/*.test.ts",
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
      // The environment wrapper hides these build/server entrypoints from
      // package.json script discovery.
      entry: [
        "scripts/buildApp.ts",
        "src/index.tsx",
        "src/servers/devServer.ts",
        "src/servers/e2eServer.ts",
        "e2e/**/*.spec.ts",
        // Bundled by the diagnostics browser test through a runtime path.
        "e2e/fixtures/diagnostics.ts",
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
        "hutch.config.ts",
        "scripts/packageElectrobunAssets.ts",
        "src/bun/index.ts",
        "src/renderer/index.tsx",
        "src/renderer/databaseWorker.ts",
      ],
      project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "*.config.ts"],
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
      // Public package exports plus the package's executable test entries.
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
  },
} satisfies KnipConfig;

// Production reachability starts at executable roots and public package exports.
// Test helpers remain checked by the default pass, without making test-only
// importers keep runtime implementation alive in this pass.
const productionProject = [
  "src/**/*.{ts,tsx}!",
  "!src/**/*.test.{ts,tsx}",
  "!src/**/*.testFixtures.{ts,tsx}",
  "!src/**/testFixtures.{ts,tsx}",
  "!src/**/testUtils.{ts,tsx}",
  "!src/**/*.testUtils.{ts,tsx}",
  "!src/**/*TestFixtures.{ts,tsx}",
  "!src/**/test/**",
  "!src/**/tests/**",
];

const productionConfig = {
  ...strictConfigDefaults,
  // The default pass checks exports, including intentional test seams. This
  // pass adds runtime file reachability without treating test seams as dead API.
  exclude: ["exports", "types", "enumMembers", "namespaceMembers"],
  workspaces: {
    ".": rootToolingWorkspace,
    "packages/agent-tool": {
      entry: ["src/index.ts!"],
      project: productionProject,
    },
    "packages/api": {
      entry: [
        "src/index.ts!",
        "scripts/blobGc.ts!",
        "scripts/stripeSeatSync.ts!",
      ],
      project: [...productionProject, "!src/appTestRuntime.ts"],
    },
    "packages/api-client": { project: productionProject },
    "packages/api-cli": {
      entry: ["src/index.ts!"],
      project: productionProject,
    },
    "packages/api-shared": { project: productionProject },
    "packages/app": { project: productionProject },
    "packages/app-web": {
      entry: [
        "scripts/buildApp.ts!",
        "src/index.tsx!",
        "src/servers/devServer.ts!",
      ],
      project: [...productionProject, "!src/servers/e2eServer.ts"],
    },
    "packages/app-capacitor": {
      entry: [
        "src/index.tsx!",
        "capacitor.config.ts!",
        "scripts/buildWorker.ts!",
      ],
      project: productionProject,
      ignoreDependencies: [
        ...capacitorNativePluginDependencies,
        "@capacitor/core",
      ],
    },
    "packages/app-electrobun": {
      entry: [
        "electrobun.config.ts!",
        "src/bun/index.ts!",
        "src/renderer/index.tsx!",
        "src/renderer/databaseWorker.ts!",
      ],
      project: productionProject,
    },
    "packages/bob-and-alice": { project: productionProject },
    "packages/client-sdk": {
      // The manifest points at dist; these are its runtime source facades.
      entry: ["src/index.ts!", "src/sqlite.ts!"],
      project: productionProject,
    },
    "packages/crypto": { project: productionProject },
    "packages/encoding": { project: productionProject },
    "packages/loro": { project: productionProject },
    "packages/ui": { project: productionProject },
    "packages/validators": {
      // OpenAPI generator implementation/output is checked by the default pass.
      project: [
        ...productionProject,
        "!src/operation/openApi.ts",
        "!src/operation/openApiResponseMetadata.ts",
        "!src/operation/generatedOpenApi.ts",
      ],
    },
    "packages/website": {
      entry: ["astro.config.ts!", "src/pages/**/*.astro!"],
      project: ["src/**/*.{astro,ts,tsx}!", "!src/**/*.test.ts"],
      ignoreDependencies: ["@astrojs/react", "react-dom"],
    },
    "packages/sqlite-instance": { project: productionProject },
    "packages/sqlite-worker": { project: productionProject },
    "packages/test-utils": { project: productionProject },
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
