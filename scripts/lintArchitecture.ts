import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IConfiguration, ICruiseOptions } from "dependency-cruiser";
import { cruise } from "dependency-cruiser";

import dependencyCruiserConfig from "../dependency-cruiser.config";

const architectureEntryPoints = [
  "packages/api/src",
  "packages/app/src",
  "packages/client-sdk/src",
];
const appPresentationEntryPoints = [
  "packages/app/src/components",
  "packages/app/src/document-types",
  "packages/app/src/mini-apps",
];
const appReactFreeLayerEntryPoints = ["packages/client-sdk/src"];
const appProductionSourceEntryPoints = ["packages/app/src"];
const appTestSourceEntryPoints = ["packages/app/src"];
const appTestHelperEntryPoints = ["packages/app/test/helpers"];
const clientSdkPackageJsonPath = "packages/client-sdk/package.json";
const clientSdkRootIndexPath = "packages/client-sdk/src/index.ts";
const clientSdkSupportedPackageExports = {
  ".": "./src/index.ts",
  "./stores/documents": "./src/stores/documents/index.ts",
  "./workflows/blobs": "./src/workflows/blobs/index.ts",
  "./workflows/contacts": "./src/workflows/contacts/index.ts",
  "./workflows/containers": "./src/workflows/containers/index.ts",
  "./workflows/documents": "./src/workflows/documents/index.ts",
  "./workflows/explorer": "./src/workflows/explorer/index.ts",
  "./workflows/organizations": "./src/workflows/organizations/index.ts",
  "./workflows/principals": "./src/workflows/principals/index.ts",
  "./workflows/registration": "./src/workflows/registration/index.ts",
  "./workflows/sync": "./src/workflows/sync/index.ts",
} as const;
const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
const testFilePattern = /\.test\.[tj]sx?$/;
const rawSqlExecutorPattern = /\b(?:ExecSql|execSql)\b/;
const reactImportPattern =
  /\bfrom\s*["']react(?:\/[^"']*)?["']|\bimport\s*(?:\(\s*)?["']react(?:\/[^"']*)?["']/;
const appTestHelperImportPattern =
  /\bfrom\s*["'][^"']*test\/helpers\/|\bimport\s*(?:\(\s*)?["'][^"']*test\/helpers\//;
const appSdkDataImportPattern =
  /\bfrom\s*["']@tearleads\/client-sdk\/data\/|\bimport\s*(?:\(\s*)?["']@tearleads\/client-sdk\/data\//;
const clientSdkRootFacadeExportPattern =
  /\bexport\b.*?\bfrom\s*["']\.\/(?:stores|workflows)(?:\/|["'])/;

interface SourceMatch {
  filePath: string;
  line: string;
  lineNumber: number;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  description?: string;
  devDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: unknown;
  main?: unknown;
  module?: unknown;
  name?: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  private?: boolean;
  sideEffects?: boolean;
  type?: string;
  types?: unknown;
  version?: string;
}

interface ClientSdkPackageStatusViolation {
  detail: string;
  field: string;
}

interface ClientSdkPackageExportContractViolation {
  detail: string;
  exportPath: string;
}

interface ClientSdkWorkspaceDependencyViolation {
  dependencyName: string;
  dependencySection: string;
  declaredRange: string;
}

let clientSdkPackageJsonPromise: Promise<PackageJson> | undefined;

const clientSdkPackageStatusContract = {
  name: "@tearleads/client-sdk",
  private: true,
  sideEffects: false,
  type: "module",
} as const;
const clientSdkSourceOnlyArtifactFields = [
  "files",
  "main",
  "module",
  "types",
] as const;
const clientSdkPackageDependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const clientSdkProductUiVocabularyPattern =
  /\b(?:MiniApp|OrgManager|mini-apps?|org-manager)/i;

function configToCruiseOptions(config: IConfiguration): ICruiseOptions {
  const { options = {}, ...ruleSet } = config;

  return {
    ...options,
    outputType: "err",
    ruleSet,
    validate: Object.keys(ruleSet).length > 0,
  };
}

async function listProductionSourceFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listProductionSourceFiles(entryPath);
      }

      if (
        productionSourceFilePattern.test(entryPath) &&
        !testFilePattern.test(entryPath)
      ) {
        return [entryPath];
      }

      return [];
    }),
  );

  return nestedFiles.flat();
}

async function listTestSourceFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listTestSourceFiles(entryPath);
      }

      if (testFilePattern.test(entryPath)) {
        return [entryPath];
      }

      return [];
    }),
  );

  return nestedFiles.flat();
}

function isCommentOnlyLine(line: string): boolean {
  const trimmedLine = line.trimStart();
  return (
    trimmedLine.startsWith("//") ||
    trimmedLine.startsWith("/*") ||
    trimmedLine.startsWith("*")
  );
}

async function findAppPresentationSqlExecutorReferences(): Promise<
  SourceMatch[]
> {
  return findSourceMatches(appPresentationEntryPoints, rawSqlExecutorPattern);
}

async function findAppReactFreeLayerReferences(): Promise<SourceMatch[]> {
  return findSourceMatches(appReactFreeLayerEntryPoints, reactImportPattern);
}

async function findAppProductionTestHelperReferences(): Promise<SourceMatch[]> {
  return findSourceMatches(
    appProductionSourceEntryPoints,
    appTestHelperImportPattern,
  );
}

async function findAppProductionSdkDataImports(): Promise<SourceMatch[]> {
  return findSourceMatches(
    appProductionSourceEntryPoints,
    appSdkDataImportPattern,
  );
}

async function findAppTestHelperSdkDataImports(): Promise<SourceMatch[]> {
  return findSourceMatches(appTestHelperEntryPoints, appSdkDataImportPattern);
}

async function findAppTestSdkDataImports(): Promise<SourceMatch[]> {
  return findSourceMatches(
    appTestSourceEntryPoints,
    appSdkDataImportPattern,
    listTestSourceFiles,
  );
}

async function readClientSdkPackageJson(): Promise<PackageJson> {
  clientSdkPackageJsonPromise ??= readFile(
    clientSdkPackageJsonPath,
    "utf8",
  ).then((content) => JSON.parse(content) as PackageJson);

  return clientSdkPackageJsonPromise;
}

function packageExportConditionTarget(
  exportTarget: unknown,
  condition: string,
): string | undefined {
  if (
    !exportTarget ||
    typeof exportTarget !== "object" ||
    Array.isArray(exportTarget)
  ) {
    return undefined;
  }

  const conditionalExport = exportTarget as Record<string, unknown>;
  const conditionTarget = conditionalExport[condition];

  return typeof conditionTarget === "string" ? conditionTarget : undefined;
}

function buildClientSdkPackageExportViolation(
  exportPath: string,
  detail: string,
): ClientSdkPackageExportContractViolation {
  return { detail, exportPath };
}

function buildClientSdkPackageStatusViolation(
  field: string,
  detail: string,
): ClientSdkPackageStatusViolation {
  return { detail, field };
}

async function findClientSdkPackageStatusViolations(): Promise<
  ClientSdkPackageStatusViolation[]
> {
  const packageJson = await readClientSdkPackageJson();
  const contractViolations = Object.entries(clientSdkPackageStatusContract)
    .map(([field, expectedValue]) => {
      const actualValue = packageJson[field as keyof PackageJson];

      return actualValue === expectedValue
        ? undefined
        : buildClientSdkPackageStatusViolation(
            field,
            `should be ${JSON.stringify(expectedValue)}`,
          );
    })
    .filter(
      (violation): violation is ClientSdkPackageStatusViolation =>
        violation !== undefined,
    );
  const artifactFieldViolations = clientSdkSourceOnlyArtifactFields
    .filter((field) => Object.hasOwn(packageJson, field))
    .map((field) =>
      buildClientSdkPackageStatusViolation(
        field,
        "should be omitted while package exports target TypeScript source files",
      ),
    );

  return [...contractViolations, ...artifactFieldViolations];
}

async function findClientSdkWorkspaceDependencyViolations(): Promise<
  ClientSdkWorkspaceDependencyViolation[]
> {
  const packageJson = await readClientSdkPackageJson();

  return clientSdkPackageDependencySections.flatMap((dependencySection) => {
    const dependencies = packageJson[dependencySection] ?? {};

    return Object.entries(dependencies).flatMap(
      ([dependencyName, declaredRange]) => {
        if (
          !dependencyName.startsWith("@tearleads/") ||
          declaredRange === "workspace:*"
        ) {
          return [];
        }

        return [
          {
            declaredRange,
            dependencyName,
            dependencySection,
          },
        ];
      },
    );
  });
}

async function findClientSdkPackageExportContractViolations(): Promise<
  ClientSdkPackageExportContractViolation[]
> {
  const packageJson = await readClientSdkPackageJson();
  const packageExports = packageJson.exports ?? {};
  const expectedExports = Object.entries(clientSdkSupportedPackageExports);
  const missingOrChangedExports = expectedExports.flatMap(
    ([exportPath, expectedTarget]) => {
      const exportTarget = packageExports[exportPath];

      if (!exportTarget) {
        return [buildClientSdkPackageExportViolation(exportPath, "missing")];
      }

      const defaultTarget = packageExportConditionTarget(
        exportTarget,
        "default",
      );
      const typesTarget = packageExportConditionTarget(exportTarget, "types");

      return [
        defaultTarget === expectedTarget
          ? undefined
          : buildClientSdkPackageExportViolation(
              exportPath,
              `default target should be ${expectedTarget}`,
            ),
        typesTarget === expectedTarget
          ? undefined
          : buildClientSdkPackageExportViolation(
              exportPath,
              `types target should be ${expectedTarget}`,
            ),
      ].filter(
        (violation): violation is ClientSdkPackageExportContractViolation =>
          violation !== undefined,
      );
    },
  );
  const unexpectedExports = Object.keys(packageExports)
    .filter(
      (exportPath) =>
        !Object.hasOwn(clientSdkSupportedPackageExports, exportPath),
    )
    .map((exportPath) =>
      buildClientSdkPackageExportViolation(exportPath, "unexpected"),
    );

  return [...missingOrChangedExports, ...unexpectedExports];
}

async function findClientSdkDataPackageExports(): Promise<string[]> {
  const packageJson = await readClientSdkPackageJson();

  return Object.keys(packageJson.exports ?? {}).filter(
    (exportPath) => exportPath === "./data" || exportPath.startsWith("./data/"),
  );
}

async function findClientSdkDeepFacadePackageExports(): Promise<string[]> {
  const packageJson = await readClientSdkPackageJson();

  return Object.keys(packageJson.exports ?? {}).filter((exportPath) =>
    /^\.\/(?:stores|workflows)\/[^/]+\/.+/.test(exportPath),
  );
}

async function listExactSourceFile(filePath: string): Promise<string[]> {
  return [filePath];
}

async function findClientSdkRootFacadeReExports(): Promise<SourceMatch[]> {
  return findSourceMatches(
    [clientSdkRootIndexPath],
    clientSdkRootFacadeExportPattern,
    listExactSourceFile,
  );
}

async function findClientSdkProductUiVocabularyReferences(): Promise<
  SourceMatch[]
> {
  return findSourceMatches(
    appReactFreeLayerEntryPoints,
    clientSdkProductUiVocabularyPattern,
  );
}

async function findSourceMatches(
  entryPoints: ReadonlyArray<string>,
  pattern: RegExp,
  listFiles: (dirPath: string) => Promise<string[]> = listProductionSourceFiles,
): Promise<SourceMatch[]> {
  const sourceFiles = (await Promise.all(entryPoints.map(listFiles))).flat();
  const fileMatches = await Promise.all(
    sourceFiles.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");

      return content.split("\n").flatMap((line, index): SourceMatch[] => {
        if (isCommentOnlyLine(line) || !pattern.test(line)) {
          return [];
        }

        return [{ filePath, line, lineNumber: index + 1 }];
      });
    }),
  );

  return fileMatches.flat();
}

function formatAppPresentationSqlExecutorReferences(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error app-presentation-does-not-thread-raw-sql-executors: App presentation files should go through stores or providers instead of accepting, passing, or importing raw ExecSql values.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

function formatAppReactFreeLayerReferences(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error app-data-and-workflows-do-not-import-react: App data and workflow files should stay below React runtime and presentation code.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

function formatAppProductionTestHelperReferences(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error app-production-source-does-not-import-test-helpers: App test helpers belong under packages/app/test and must not be imported by production src files.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

function formatAppProductionSdkDataImports(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error app-production-uses-sdk-root-or-facades: App production code should import client SDK contracts from @tearleads/client-sdk or workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

function formatAppTestHelperSdkDataImports(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error app-test-helpers-use-sdk-root-or-facades: App test helpers should import client SDK contracts from @tearleads/client-sdk or workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

function formatAppTestSdkDataImports(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error app-tests-use-sdk-root-or-facades: App tests should import client SDK contracts from @tearleads/client-sdk or workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

function formatClientSdkDataPackageExports(
  exportPaths: ReadonlyArray<string>,
): string {
  if (exportPaths.length === 0) {
    return "";
  }

  return [
    "error client-sdk-does-not-export-data-internals: Client SDK data internals should stay package-internal; promote contracts through the root or explicit workflow/store facades instead.",
    ...exportPaths.map(
      (exportPath) => `  ${clientSdkPackageJsonPath}: ${exportPath}`,
    ),
  ].join("\n");
}

function formatClientSdkPackageStatusViolations(
  violations: ReadonlyArray<ClientSdkPackageStatusViolation>,
): string {
  if (violations.length === 0) {
    return "";
  }

  return [
    "error client-sdk-package-status-stays-private-source-consumed: Client SDK package metadata should match the documented private, source-consumed package contract until an external release build exists.",
    ...violations.map(
      (violation) =>
        `  ${clientSdkPackageJsonPath}: ${violation.field} ${violation.detail}`,
    ),
  ].join("\n");
}

function formatClientSdkWorkspaceDependencyViolations(
  violations: ReadonlyArray<ClientSdkWorkspaceDependencyViolation>,
): string {
  if (violations.length === 0) {
    return "";
  }

  return [
    "error client-sdk-local-dependencies-use-workspace-ranges: Client SDK local package dependencies should use workspace:* while the SDK is source-consumed inside the monorepo.",
    ...violations.map(
      (violation) =>
        `  ${clientSdkPackageJsonPath}: ${violation.dependencySection}.${violation.dependencyName} is ${JSON.stringify(violation.declaredRange)}`,
    ),
  ].join("\n");
}

function formatClientSdkPackageExportContractViolations(
  violations: ReadonlyArray<ClientSdkPackageExportContractViolation>,
): string {
  if (violations.length === 0) {
    return "";
  }

  return [
    "error client-sdk-package-exports-match-supported-entry-points: Client SDK package exports should exactly match the documented root, workflow, and store facade entry points with explicit types and default targets.",
    ...violations.map(
      (violation) =>
        `  ${clientSdkPackageJsonPath}: ${violation.exportPath} ${violation.detail}`,
    ),
  ].join("\n");
}

function formatClientSdkDeepFacadePackageExports(
  exportPaths: ReadonlyArray<string>,
): string {
  if (exportPaths.length === 0) {
    return "";
  }

  return [
    "error client-sdk-exports-only-root-and-facades: Client SDK package exports should stay at the root or workflow/store facade level instead of exposing implementation files.",
    ...exportPaths.map(
      (exportPath) => `  ${clientSdkPackageJsonPath}: ${exportPath}`,
    ),
  ].join("\n");
}

function formatClientSdkRootFacadeReExports(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error client-sdk-root-exports-neutral-contracts: Client SDK root exports should stay focused on neutral contracts; workflow and store APIs belong behind explicit facade subpaths.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

function formatClientSdkProductUiVocabularyReferences(
  matches: ReadonlyArray<SourceMatch>,
): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "error client-sdk-workflows-use-platform-taxonomy: Client SDK source should use platform workflow names and keep product/app window vocabulary in packages/app.",
    ...matches.map(
      (match) =>
        `  ${match.filePath}:${match.lineNumber}: ${match.line.trim()}`,
    ),
  ].join("\n");
}

const result = await cruise(
  architectureEntryPoints,
  configToCruiseOptions(dependencyCruiserConfig),
);
const appPresentationSqlExecutorReferences =
  await findAppPresentationSqlExecutorReferences();
const appReactFreeLayerReferences = await findAppReactFreeLayerReferences();
const appProductionTestHelperReferences =
  await findAppProductionTestHelperReferences();
const appProductionSdkDataImports = await findAppProductionSdkDataImports();
const appTestHelperSdkDataImports = await findAppTestHelperSdkDataImports();
const appTestSdkDataImports = await findAppTestSdkDataImports();
const clientSdkPackageStatusViolations =
  await findClientSdkPackageStatusViolations();
const clientSdkWorkspaceDependencyViolations =
  await findClientSdkWorkspaceDependencyViolations();
const clientSdkPackageExportContractViolations =
  await findClientSdkPackageExportContractViolations();
const clientSdkDataPackageExports = await findClientSdkDataPackageExports();
const clientSdkDeepFacadePackageExports =
  await findClientSdkDeepFacadePackageExports();
const clientSdkRootFacadeReExports = await findClientSdkRootFacadeReExports();
const clientSdkProductUiVocabularyReferences =
  await findClientSdkProductUiVocabularyReferences();

if (typeof result.output === "string" && result.output.trim().length > 0) {
  const write = result.exitCode === 0 ? console.log : console.error;
  write(result.output.trim());
}

const appPresentationSqlExecutorOutput =
  formatAppPresentationSqlExecutorReferences(
    appPresentationSqlExecutorReferences,
  );
if (appPresentationSqlExecutorOutput.length > 0) {
  console.error(appPresentationSqlExecutorOutput);
}

const appReactFreeLayerOutput = formatAppReactFreeLayerReferences(
  appReactFreeLayerReferences,
);
if (appReactFreeLayerOutput.length > 0) {
  console.error(appReactFreeLayerOutput);
}

const appProductionTestHelperOutput = formatAppProductionTestHelperReferences(
  appProductionTestHelperReferences,
);
if (appProductionTestHelperOutput.length > 0) {
  console.error(appProductionTestHelperOutput);
}

const appProductionSdkDataOutput = formatAppProductionSdkDataImports(
  appProductionSdkDataImports,
);
if (appProductionSdkDataOutput.length > 0) {
  console.error(appProductionSdkDataOutput);
}

const appTestHelperSdkDataOutput = formatAppTestHelperSdkDataImports(
  appTestHelperSdkDataImports,
);
if (appTestHelperSdkDataOutput.length > 0) {
  console.error(appTestHelperSdkDataOutput);
}

const appTestSdkDataOutput = formatAppTestSdkDataImports(appTestSdkDataImports);
if (appTestSdkDataOutput.length > 0) {
  console.error(appTestSdkDataOutput);
}

const clientSdkPackageStatusOutput = formatClientSdkPackageStatusViolations(
  clientSdkPackageStatusViolations,
);
if (clientSdkPackageStatusOutput.length > 0) {
  console.error(clientSdkPackageStatusOutput);
}

const clientSdkWorkspaceDependencyOutput =
  formatClientSdkWorkspaceDependencyViolations(
    clientSdkWorkspaceDependencyViolations,
  );
if (clientSdkWorkspaceDependencyOutput.length > 0) {
  console.error(clientSdkWorkspaceDependencyOutput);
}

const clientSdkPackageExportContractOutput =
  formatClientSdkPackageExportContractViolations(
    clientSdkPackageExportContractViolations,
  );
if (clientSdkPackageExportContractOutput.length > 0) {
  console.error(clientSdkPackageExportContractOutput);
}

const clientSdkDataPackageExportsOutput = formatClientSdkDataPackageExports(
  clientSdkDataPackageExports,
);
if (clientSdkDataPackageExportsOutput.length > 0) {
  console.error(clientSdkDataPackageExportsOutput);
}

const clientSdkDeepFacadePackageExportsOutput =
  formatClientSdkDeepFacadePackageExports(clientSdkDeepFacadePackageExports);
if (clientSdkDeepFacadePackageExportsOutput.length > 0) {
  console.error(clientSdkDeepFacadePackageExportsOutput);
}

const clientSdkRootFacadeReExportsOutput = formatClientSdkRootFacadeReExports(
  clientSdkRootFacadeReExports,
);
if (clientSdkRootFacadeReExportsOutput.length > 0) {
  console.error(clientSdkRootFacadeReExportsOutput);
}

const clientSdkProductUiVocabularyOutput =
  formatClientSdkProductUiVocabularyReferences(
    clientSdkProductUiVocabularyReferences,
  );
if (clientSdkProductUiVocabularyOutput.length > 0) {
  console.error(clientSdkProductUiVocabularyOutput);
}

process.exit(
  result.exitCode !== 0 ||
    appPresentationSqlExecutorReferences.length > 0 ||
    appReactFreeLayerReferences.length > 0 ||
    appProductionTestHelperReferences.length > 0 ||
    appProductionSdkDataImports.length > 0 ||
    appTestHelperSdkDataImports.length > 0 ||
    appTestSdkDataImports.length > 0 ||
    clientSdkPackageStatusViolations.length > 0 ||
    clientSdkWorkspaceDependencyViolations.length > 0 ||
    clientSdkPackageExportContractViolations.length > 0 ||
    clientSdkDataPackageExports.length > 0 ||
    clientSdkDeepFacadePackageExports.length > 0 ||
    clientSdkRootFacadeReExports.length > 0 ||
    clientSdkProductUiVocabularyReferences.length > 0
    ? 1
    : 0,
);
