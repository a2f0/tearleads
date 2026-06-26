const dependencyCruiserPackageNames = [
  "api",
  "api-client",
  "api-cli",
  "api-shared",
  "app",
  "app-demo",
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

export const packageSourcePath = {
  api: packageSourceEntryPoint("api"),
  apiClient: packageSourceEntryPoint("api-client"),
  apiCli: packageSourceEntryPoint("api-cli"),
  apiShared: packageSourceEntryPoint("api-shared"),
  app: packageSourceEntryPoint("app"),
  appDemo: packageSourceEntryPoint("app-demo"),
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

export const packageSourceRoot = {
  api: packageSourceRootPattern(packageSourcePath.api),
  apiClient: packageSourceRootPattern(packageSourcePath.apiClient),
  apiCli: packageSourceRootPattern(packageSourcePath.apiCli),
  apiShared: packageSourceRootPattern(packageSourcePath.apiShared),
  app: packageSourceRootPattern(packageSourcePath.app),
  appDemo: packageSourceRootPattern(packageSourcePath.appDemo),
  appElectrobun: packageSourceRootPattern(packageSourcePath.appElectrobun),
  appWeb: packageSourceRootPattern(packageSourcePath.appWeb),
  bobAndAlice: packageSourceRootPattern(packageSourcePath.bobAndAlice),
  clientSdk: packageSourceRootPattern(packageSourcePath.clientSdk),
  codeAssist: packageSourceRootPattern(packageSourcePath.codeAssist),
  crypto: packageSourceRootPattern(packageSourcePath.crypto),
  encoding: packageSourceRootPattern(packageSourcePath.encoding),
  loro: packageSourceRootPattern(packageSourcePath.loro),
  sqliteInstance: packageSourceRootPattern(packageSourcePath.sqliteInstance),
  sqliteWorker: packageSourceRootPattern(packageSourcePath.sqliteWorker),
  testUtils: packageSourceRootPattern(packageSourcePath.testUtils),
  ui: packageSourceRootPattern(packageSourcePath.ui),
  validators: packageSourceRootPattern(packageSourcePath.validators),
  website: packageSourceRootPattern(packageSourcePath.website),
} as const;

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
