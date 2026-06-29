const dependencyCruiserPackageNames = [
  "api",
  "api-client",
  "api-cli",
  "api-shared",
  "app",
  "app-electrobun",
  "app-web",
  "bob-and-alice",
  "client-sdk",
  "code-assist",
  "crypto",
  "encoding",
  "loro",
  "sqlite-instance",
  "sqlite-worker",
  "test-utils",
  "ui",
  "validators",
  "website",
] as const;

function packageSourceEntryPoint(packageName: string): string {
  return `packages/${packageName}/src`;
}

function packageSourceRootPattern(sourcePath: string): string {
  return `^${sourcePath}/`;
}

// Shared file-name patterns. Single source of truth for the architecture lint
// harness (scripts/lintArchitecture.ts), the subsystem manifest
// (scripts/subsystems.ts), and the dependency-cruiser config (which consumes the
// `.source` string form).
export const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
export const testFilePattern = /\.test\.[tj]sx?$/;

export const packageSourcePath = {
  api: packageSourceEntryPoint("api"),
  apiClient: packageSourceEntryPoint("api-client"),
  apiCli: packageSourceEntryPoint("api-cli"),
  apiShared: packageSourceEntryPoint("api-shared"),
  app: packageSourceEntryPoint("app"),
  appElectrobun: packageSourceEntryPoint("app-electrobun"),
  appWeb: packageSourceEntryPoint("app-web"),
  bobAndAlice: packageSourceEntryPoint("bob-and-alice"),
  clientSdk: packageSourceEntryPoint("client-sdk"),
  codeAssist: packageSourceEntryPoint("code-assist"),
  crypto: packageSourceEntryPoint("crypto"),
  encoding: packageSourceEntryPoint("encoding"),
  loro: packageSourceEntryPoint("loro"),
  sqliteInstance: packageSourceEntryPoint("sqlite-instance"),
  sqliteWorker: packageSourceEntryPoint("sqlite-worker"),
  testUtils: packageSourceEntryPoint("test-utils"),
  ui: packageSourceEntryPoint("ui"),
  validators: packageSourceEntryPoint("validators"),
  website: packageSourceEntryPoint("website"),
} as const;

export const packageSourceRoot = Object.fromEntries(
  Object.entries(packageSourcePath).map(([key, sourcePath]) => [
    key,
    packageSourceRootPattern(sourcePath),
  ]),
) as { readonly [Key in keyof typeof packageSourcePath]: string };

export const allPackageSourceRoots: readonly string[] =
  Object.values(packageSourceRoot);

export const deploymentTargetSourceRoots: readonly string[] = [
  packageSourceRoot.appElectrobun,
  packageSourceRoot.appWeb,
  packageSourceRoot.website,
] as const;

export const dependencyCruiserEntryPoints = dependencyCruiserPackageNames.map(
  packageSourceEntryPoint,
);

export const dependencyCruiserIncludeOnly = `^packages/(${dependencyCruiserPackageNames.join("|")})/src/`;
