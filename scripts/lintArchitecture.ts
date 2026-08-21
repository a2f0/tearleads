import {
  type ArchitectureCheck,
  type ArchitectureCheckResult,
  createListCheck,
  createModuleSpecifierCheck,
  createSourceTextCheck,
  listExactSourceFile,
  listProductionSourceFiles,
  listTestSourceFiles,
} from "./architecture/checkFactories";
import {
  clientSdkPackageJsonPath,
  clientSdkRootWorkflowFacadeReExports,
  findClientSdkDataPackageExports,
  findClientSdkPackageExportContractViolations,
  findClientSdkPackageStatusViolations,
  findClientSdkPublicApiDocsViolations,
  findClientSdkWorkflowTaxonomyDocsViolations,
  findClientSdkWorkspaceDependencyViolations,
} from "./architecture/clientSdkPackageContract";
import { runDependencyCruiserCheck } from "./architecture/dependencyCruiserCheck";
import { findWorkspaceRegistryViolations } from "./architecture/workspaceRegistryContract";
import { packageSourcePath } from "./dependencySourceRoots";
import {
  findSubsystemCoverageViolations,
  findSubsystemDocsViolations,
  miniAppNames,
} from "./subsystems";

const appSrc = packageSourcePath.app;
const sdkSrc = packageSourcePath.clientSdk;
const appPresentationEntryPoints = [
  `${appSrc}/components`,
  `${appSrc}/document-types`,
  `${appSrc}/mini-apps`,
];
const appDocumentProjectionSourcePaths = new Set([
  `${appSrc}/document-types/projectors.ts`,
]);
const appMiniAppBusSourcePath = `${appSrc}/mini-apps/bus.tsx`;
const appPaneProviderSourcePath = `${appSrc}/components/pane/runtime/PaneProvider.tsx`;
const appSymCryptSubscriptionHelperPath = `${appSrc}/providers/sdk/useSymCryptSubscription.ts`;
const appProductionSourceEntryPoints = [appSrc];
const appTestSourceEntryPoints = [appSrc];
const appTestHelperEntryPoints = ["packages/app/test/helpers"];
const clientSdkSourceEntryPoints = [sdkSrc];
const clientSdkTestHelperEntryPoints = ["packages/client-sdk/test/helpers"];
const clientSdkClientFacadeIndexPath = `${sdkSrc}/client/index.ts`;
const clientSdkRootIndexPath = `${sdkSrc}/index.ts`;
const clientSdkRootAllowedReExports = new Set([
  "./client",
  "./documents",
  "./stores/container-contents",
  "./stores/documents",
  ...clientSdkRootWorkflowFacadeReExports,
]);
const directSyncExternalStorePattern = /\buseSyncExternalStore\b/;
// Flags raw SQL-executor handles threaded through presentation code. Coupled to
// the `ExecSql`/`execSql` names by design: if those symbols are renamed this
// check silently stops matching, so rename in lockstep.
const rawSqlExecutorPattern = /\b(?:ExecSql|execSql)\b/;
// Forbids prefixed compatibility aliases (`... as SymCryptFoo`) on the SDK root
// facade. Scanned line by line, so a rare multiline `as\n  SymCryptFoo` would
// slip through — acceptable since the codebase keeps aliases on one line.
const clientSdkPrefixedFacadeAliasPattern =
  /\bas\s+(?:SymCrypt[A-Z][A-Za-z0-9_]*|SYMCRYPT_[A-Z0-9_]+)/;
// A deliberately-curated substring heuristic that keeps product/app-window
// vocabulary out of SDK source. It is intentionally a *subset* of the mini-apps
// (the words most likely to leak); it is NOT derived from miniAppNames because
// matching every mini-app word (e.g. "notes", "contacts", "identity") would
// false-positive on unrelated SDK identifiers. As a substring match it can also
// over-match inside larger identifiers — a known, accepted limitation.
const clientSdkProductUiVocabularyPattern =
  /\b(?:Explorer|MiniApp|OrgManager|explorer|mini-apps?|org-manager)/;

async function listAppPresentationSourceFiles(
  dirPath: string,
): Promise<string[]> {
  const productionSourceFiles = await listProductionSourceFiles(dirPath);
  return productionSourceFiles.filter(
    (filePath) => !appDocumentProjectionSourcePaths.has(filePath),
  );
}

async function listAppSourceFilesOutsideSymCryptSubscriptionHelper(
  dirPath: string,
): Promise<string[]> {
  const productionSourceFiles = await listProductionSourceFiles(dirPath);
  return productionSourceFiles.filter(
    (filePath) => filePath !== appSymCryptSubscriptionHelperPath,
  );
}

function isReactImport(specifier: string): boolean {
  return specifier === "react" || specifier.startsWith("react/");
}

function isAppTestHelperImport(specifier: string): boolean {
  return /(?:^|\/)test\/helpers(?:\/|$)/.test(specifier);
}

// Matches an import of a `@symcrypt/client-sdk/<subpath>` package subpath
// (the subpath entry itself or anything beneath it).
function clientSdkSubpathImport(
  subpath: string,
): (specifier: string) => boolean {
  const entry = `@symcrypt/client-sdk/${subpath}`;
  return (specifier) =>
    specifier === entry || specifier.startsWith(`${entry}/`);
}

const isClientSdkDataImport = clientSdkSubpathImport("data");
const isClientSdkDocumentsImport = clientSdkSubpathImport("documents");
const isClientSdkWorkflowImport = clientSdkSubpathImport("workflows");
const isClientSdkStoreImport = clientSdkSubpathImport("stores");
const isClientSdkTestingImport = clientSdkSubpathImport("testing");

function isClientSdkStoreOrWorkflowImport(specifier: string): boolean {
  return (
    isClientSdkStoreImport(specifier) || isClientSdkWorkflowImport(specifier)
  );
}

function isUnsupportedClientSdkRootReExport(specifier: string): boolean {
  return (
    specifier.startsWith(".") && !clientSdkRootAllowedReExports.has(specifier)
  );
}

// A sibling import of a concrete mini-app (e.g. `./explorer`). Built from the
// registry's mini-app list so it covers every mini-app on disk and cannot drift
// the way the previous hand-maintained alternation did (it had missed
// system-monitor and backup-restore).
const appMiniAppSiblingImportPattern = new RegExp(
  `^\\./(?:${miniAppNames.join("|")})(?:/|$)`,
);

function isAppMiniAppBusBoundaryImport(specifier: string): boolean {
  return (
    specifier.startsWith("@symcrypt/") ||
    /^\.\.\/(?:providers|stores|document-types)(?:\/|$)/.test(specifier) ||
    appMiniAppSiblingImportPattern.test(specifier)
  );
}

function isPaneRuntimeProviderBypassImport(specifier: string): boolean {
  return (
    specifier.startsWith("../../providers/") &&
    !specifier.startsWith("../../providers/AppRuntimeProvider")
  );
}

const architectureChecks: ArchitectureCheck[] = [
  createSourceTextCheck({
    entryPoints: appPresentationEntryPoints,
    listFiles: listAppPresentationSourceFiles,
    message:
      "App presentation files should go through stores or providers instead of accepting, passing, or importing raw ExecSql values.",
    name: "app-presentation-does-not-thread-raw-sql-executors",
    pattern: rawSqlExecutorPattern,
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkSourceEntryPoints,
    matches: isReactImport,
    message:
      "Client SDK source should stay below React runtime and presentation code.",
    name: "client-sdk-source-does-not-import-react",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isAppTestHelperImport,
    message:
      "App test helpers belong under packages/app/test and must not be imported by production src files.",
    name: "app-production-source-does-not-import-test-helpers",
  }),
  createSourceTextCheck({
    entryPoints: appProductionSourceEntryPoints,
    listFiles: listAppSourceFilesOutsideSymCryptSubscriptionHelper,
    message:
      "App production code should centralize React external-store subscriptions in providers/sdk/useSymCryptSubscription.ts.",
    name: "app-production-centralizes-use-sync-external-store",
    pattern: directSyncExternalStorePattern,
  }),
  createModuleSpecifierCheck({
    entryPoints: [appMiniAppBusSourcePath],
    listFiles: listExactSourceFile,
    matches: isAppMiniAppBusBoundaryImport,
    message:
      "Mini-app bus should stay SDK-independent app window/message infrastructure; pass SDK-backed data, providers, stores, and concrete mini-app definitions in from callers.",
    name: "app-mini-app-bus-stays-sdk-independent",
  }),
  createModuleSpecifierCheck({
    entryPoints: [appPaneProviderSourcePath],
    listFiles: listExactSourceFile,
    matches: isPaneRuntimeProviderBypassImport,
    message:
      "PaneProvider should delegate runtime provider ordering to providers/AppRuntimeProvider instead of importing individual app runtime providers.",
    name: "app-pane-provider-uses-runtime-provider-aggregate",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkDataImport,
    message:
      "App production code should import client SDK contracts from @symcrypt/client-sdk or @symcrypt/client-sdk/sqlite instead of @symcrypt/client-sdk/data/* internals.",
    name: "app-production-uses-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkTestingImport,
    message:
      "App production code must not import nominal client SDK test fixtures.",
    name: "app-production-does-not-import-sdk-testing",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkDocumentsImport,
    message:
      "App production code should import public document contracts from @symcrypt/client-sdk during the entrypoint consolidation migration.",
    name: "app-production-uses-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkWorkflowImport,
    message:
      "App production code should use SDK root services, root document contracts, SQLite contracts, or app providers instead of importing SDK workflow facades directly.",
    name: "app-production-does-not-import-sdk-workflows-directly",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkStoreImport,
    message:
      "App production code should use SDK root services and app providers instead of importing SDK store facades directly.",
    name: "app-production-does-not-import-sdk-stores-directly",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestHelperEntryPoints,
    matches: isClientSdkDataImport,
    message:
      "App test helpers should import client SDK contracts from @symcrypt/client-sdk or @symcrypt/client-sdk/sqlite instead of @symcrypt/client-sdk/data/* internals.",
    name: "app-test-helpers-use-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestHelperEntryPoints,
    matches: isClientSdkDocumentsImport,
    message:
      "App test helpers should import public document contracts from @symcrypt/client-sdk.",
    name: "app-test-helpers-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestHelperEntryPoints,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "App test helpers should import public store and workflow facade symbols from @symcrypt/client-sdk.",
    name: "app-test-helpers-use-sdk-root-for-workflow-and-store-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkDataImport,
    message:
      "App tests should import client SDK contracts from @symcrypt/client-sdk or @symcrypt/client-sdk/sqlite instead of @symcrypt/client-sdk/data/* internals.",
    name: "app-tests-use-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkDocumentsImport,
    message:
      "App tests should import public document contracts from @symcrypt/client-sdk.",
    name: "app-tests-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "App tests should import public store and workflow facade symbols from @symcrypt/client-sdk.",
    name: "app-tests-use-sdk-root-for-workflow-and-store-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkDocumentsImport,
    message:
      "Client SDK tests should import public document contracts from @symcrypt/client-sdk.",
    name: "client-sdk-tests-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "Client SDK tests should import public store and workflow facade symbols from @symcrypt/client-sdk.",
    name: "client-sdk-tests-use-sdk-root-for-workflow-and-store-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkTestHelperEntryPoints,
    matches: isClientSdkDocumentsImport,
    message:
      "Client SDK test helpers should import public document contracts from @symcrypt/client-sdk.",
    name: "client-sdk-test-helpers-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkTestHelperEntryPoints,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "Client SDK test helpers should import public store and workflow facade symbols from @symcrypt/client-sdk.",
    name: "client-sdk-test-helpers-use-sdk-root-for-workflow-and-store-facades",
  }),
  createListCheck({
    findItems: findClientSdkPackageStatusViolations,
    formatItem: (violation) =>
      `${clientSdkPackageJsonPath}: ${violation.field} ${violation.detail}`,
    message:
      "Client SDK package metadata should match the documented private package contract with build-output exports.",
    name: "client-sdk-package-status-stays-private-built-package",
  }),
  createListCheck({
    findItems: findClientSdkWorkspaceDependencyViolations,
    formatItem: (violation) =>
      `${clientSdkPackageJsonPath}: ${violation.dependencySection}.${violation.dependencyName} is ${JSON.stringify(violation.declaredRange)}`,
    message:
      "Client SDK local package dependencies should use workspace:* while the SDK is source-consumed inside the monorepo.",
    name: "client-sdk-local-dependencies-use-workspace-ranges",
  }),
  createListCheck({
    findItems: findClientSdkPackageExportContractViolations,
    formatItem: (violation) =>
      `${clientSdkPackageJsonPath}: ${violation.exportPath} ${violation.detail}`,
    message:
      "Client SDK package exports should exactly match the documented root, SQLite, and testing entry points with explicit dist types and default targets.",
    name: "client-sdk-package-exports-match-supported-entry-points",
  }),
  createListCheck({
    findItems: findClientSdkPublicApiDocsViolations,
    formatItem: (violation) =>
      `${violation.docsPath}: ${violation.entryName} ${violation.detail}`,
    message:
      "Client SDK public API docs should match the supported package export entry points exactly.",
    name: "client-sdk-public-api-docs-match-package-exports",
  }),
  createListCheck({
    findItems: findClientSdkWorkflowTaxonomyDocsViolations,
    formatItem: (violation) =>
      `${violation.docsPath}: ${violation.entryName} ${violation.detail}`,
    message:
      "Client SDK workflow taxonomy docs should list each exported workflow facade exactly once.",
    name: "client-sdk-workflow-taxonomy-docs-match-package-exports",
  }),
  createListCheck({
    findItems: findClientSdkDataPackageExports,
    formatItem: (exportPath) => `${clientSdkPackageJsonPath}: ${exportPath}`,
    message:
      "Client SDK data internals should stay package-internal; promote public contracts through the root entry point instead.",
    name: "client-sdk-does-not-export-data-internals",
  }),
  createModuleSpecifierCheck({
    entryPoints: [clientSdkRootIndexPath],
    listFiles: listExactSourceFile,
    matches: isUnsupportedClientSdkRootReExport,
    message:
      "Client SDK root exports should only aggregate documented client, document, workflow, and store facades.",
    name: "client-sdk-root-exports-only-documented-facades",
  }),
  createSourceTextCheck({
    entryPoints: [clientSdkClientFacadeIndexPath],
    listFiles: listExactSourceFile,
    message:
      "Client SDK root facade exports should use canonical unprefixed names instead of prefixed compatibility aliases.",
    name: "client-sdk-root-facade-uses-unprefixed-names",
    pattern: clientSdkPrefixedFacadeAliasPattern,
  }),
  createSourceTextCheck({
    entryPoints: clientSdkSourceEntryPoints,
    message:
      "Client SDK source should use platform workflow names and keep product/app window vocabulary in packages/app.",
    name: "client-sdk-workflows-use-platform-taxonomy",
    pattern: clientSdkProductUiVocabularyPattern,
  }),
  createListCheck({
    findItems: findWorkspaceRegistryViolations,
    formatItem: (violation) => `${violation.surface}: ${violation.detail}`,
    message:
      "The workspace registry must match package manifests, TypeScript, Knip, and dependency-cruiser coverage.",
    name: "workspace-registry-matches-tooling",
  }),
  createListCheck({
    findItems: findSubsystemCoverageViolations,
    formatItem: (violation) =>
      violation.matchedSubsystems.length === 0
        ? `${violation.filePath}: not claimed by any subsystem`
        : `${violation.filePath}: claimed by multiple subsystems (${violation.matchedSubsystems.join(", ")})`,
    message:
      "Every production source file in a registered package should map to exactly one subsystem in scripts/subsystems.ts. Add the file to the owning subsystem's paths (or a new subsystem) and document it in docs/subsystems.md.",
    name: "subsystem-registry-covers-every-source-file",
  }),
  createListCheck({
    findItems: findSubsystemDocsViolations,
    formatItem: (violation) => `${violation.name} ${violation.detail}`,
    message:
      "The docs/subsystems.md registry table and scripts/subsystems.ts should list the same subsystems.",
    name: "subsystem-registry-matches-docs",
  }),
];

export async function runArchitectureLint(): Promise<number> {
  const dependencyCruiserResult = await runDependencyCruiserCheck();
  const customResults = await Promise.all(
    architectureChecks.map((check) => check.run()),
  );
  const checkResults = [
    dependencyCruiserResult,
    ...customResults.filter(
      (result): result is ArchitectureCheckResult => result !== undefined,
    ),
  ];

  for (const result of checkResults) {
    if (result.output.length === 0) {
      continue;
    }

    const write = result.failed ? console.error : console.log;
    write(result.output);
  }

  return checkResults.some((result) => result.failed) ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await runArchitectureLint();
}
