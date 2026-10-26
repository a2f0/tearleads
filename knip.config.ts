import type { KnipConfig } from "knip";

const strictConfigDefaults = {
  treatConfigHintsAsErrors: true,
  // Types used in exported signatures must remain nameable in declaration emit.
  ignoreExportsUsedInFile: { interface: true, type: true },
} as const;

const rootToolingWorkspace = {
  entry: [
    "scripts/dev/scope/browser-guard.ts",
    "scripts/dev/scope/judge/server.ts",
    "scripts/dev/scope/**/*.test.ts",
  ],
  project: ["scripts/dev/scope/**/*.ts"],
  // `markdownlint-cli2` is invoked as `bun --bun x markdownlint-cli2` so it runs
  // on Bun rather than an unpinned Node (its bin declares `engines.node >=22`,
  // and neither `.mise.toml` nor CI installs Node). Knip cannot resolve the
  // binary through `bun x`, so the dependency has to be declared used here.
  ignoreDependencies: ["@commitlint/cli", "lint-staged", "markdownlint-cli2"],
  // Codex is an operator-installed CLI, checked during Judge startup.
  ignoreBinaries: ["codex", "du", "pwsh", "shellcheck", "tokei"],
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
    "packages/diagnostics": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/api": {
      // The package test script launches Bun from `scripts/testAllDatabases.ts`;
      // Knip's Bun plugin discovers `test/preload.ts` via `bunfig.toml`. The
      // Wrangler alias targets (Loro and the driver stubs), the deploy-time
      // define printer, and the standalone operator scripts are not package
      // scripts, so they must be declared explicitly; the Worker entry comes
      // from wrangler.jsonc.
      entry: [
        "src/worker/loro/index.ts",
        "src/worker/stubs/*.ts",
        "src/**/*.test.ts",
        "test/slow/**/*.test.ts",
        // Spawned Node harness and its local-only control Worker.
        "test/helpers/hibernatingWorkerChild.ts",
        "test/helpers/hibernationControlWorker.ts",
        "scripts/blobGc.ts",
        "scripts/stripeSeatSync.ts",
        "scripts/workerDefines.ts",
      ],
      project: ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"],
      // `cloudflare:workers` is a runtime-provided module, not a package.
      ignoreDependencies: ["cloudflare"],
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
      // The teardown helper is run by terraform/scripts/drop-postgres-owned.sh.
      entry: ["src/**/*.test.ts", "scripts/dropOwnedObjects.ts"],
      project: ["src/**/*.ts", "scripts/**/*.ts"],
    },
    "packages/app": {
      // The root screenshots:seed script crosses into this workspace; Knip
      // 6.42 needs its CLI and the tests outside src declared explicitly.
      entry: [
        "src/**/*.test.{ts,tsx}",
        "test/screenshot-seed/buildScreenshotSeed.ts",
        "test/screenshot-seed/**/*.test.ts",
      ],
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
        // Knip 6.40 finds e2eServer.ts through Playwright's webServer.command.
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
        // Hutch executes this hook before signing and creating installers.
        "scripts/postBuild.ts",
        "scripts/postWrap.ts",
        // postWrap invokes Bun to expand the macOS DMG payload.
        "scripts/prepareMacosDmg.ts",
        // Invoked by the local release wrappers after artifact verification.
        "scripts/publishMacosRelease.ts",
        "scripts/publishLinuxRelease.ts",
        // Uploads the Linux container's staged source maps before publishing.
        "scripts/uploadDeferredSourceMaps.ts",
        // Verifies the native Linux build before exporting its artifacts.
        "scripts/verifyLinuxArtifacts.ts",
        "scripts/verifyWindowsArtifacts.ts",
        "scripts/readWindowsUpdateHash.ts",
        "scripts/releaseWindows.ts",
        // Invoked by the native CEF persistence smoke-test harnesses.
        "scripts/probeCefPersistence.ts",
        // Selects diagnostics inherited by the build and its packaging hook.
        "scripts/withSentryReleaseEnv.ts",
        "src/bun/index.ts",
        "src/renderer/index.tsx",
      ],
      project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "*.config.ts"],
      // scripts/sentryCliUpload.ts resolves the pinned platform binary through
      // this package by module resolution, never through a script or import.
      ignoreDependencies: ["@sentry/cli"],
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
        "src/data/documents/index.ts",
        "src/sqlite/index.ts",
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
    "packages/performance": {
      entry: ["src/**/*.test.ts", "src/database/worker.ts"],
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
    "packages/windowing": {
      entry: ["src/**/*.test.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx}"],
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
    "packages/api": {
      entry: [
        "src/index.ts!",
        "src/worker/loro/index.ts!",
        "src/worker/stubs/*.ts!",
        "scripts/blobGc.ts!",
        "scripts/stripeSeatSync.ts!",
        "scripts/workerDefines.ts!",
      ],
      project: [...productionProject, "!src/appTestRuntime.ts"],
      ignoreDependencies: ["cloudflare"],
    },
    "packages/api-client": { project: productionProject },
    "packages/api-cli": {
      entry: ["src/index.ts!"],
      project: productionProject,
    },
    "packages/api-shared": {
      entry: ["scripts/dropOwnedObjects.ts!"],
      project: productionProject,
    },
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
      ],
      project: productionProject,
    },
    // Test-only: its harness is scenario support, never shipped.
    "packages/bob-and-alice": {
      project: [...productionProject, "!src/harness/**"],
    },
    "packages/client-sdk": {
      // The manifest points at dist; these are its runtime source facades.
      entry: ["src/index.ts!", "src/sqlite/index.ts!"],
      project: productionProject,
    },
    "packages/crypto": { project: productionProject },
    "packages/diagnostics": { project: productionProject },
    "packages/encoding": { project: productionProject },
    "packages/loro": { project: productionProject },
    "packages/performance": {
      entry: [
        "src/index.ts!",
        "src/database/index.ts!",
        "src/database/worker.ts!",
      ],
      project: productionProject,
    },
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
      // Knip reads astro.config.ts as plugin configuration rather than as a
      // production root, so list the build integration it loads explicitly.
      entry: [
        "astro.config.ts!",
        "src/pages/**/*.astro!",
        "src/seoIntegration.ts!",
      ],
      project: ["src/**/*.{astro,ts,tsx}!", "!src/**/*.test.ts"],
      ignoreDependencies: ["@astrojs/react", "react-dom"],
    },
    "packages/sqlite-instance": { project: productionProject },
    "packages/sqlite-worker": { project: productionProject },
    "packages/test-utils": { project: productionProject },
    "packages/windowing": { project: productionProject },
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
