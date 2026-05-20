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
const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
const testFilePattern = /\.test\.[tj]sx?$/;
const rawSqlExecutorPattern = /\b(?:ExecSql|execSql)\b/;
const reactImportPattern =
  /\bfrom\s*["']react(?:\/[^"']*)?["']|\bimport\s*(?:\(\s*)?["']react(?:\/[^"']*)?["']/;
const appTestHelperImportPattern =
  /\bfrom\s*["'][^"']*test\/helpers\/|\bimport\s*(?:\(\s*)?["'][^"']*test\/helpers\//;
const appSdkDataImportPattern =
  /\bfrom\s*["']@tearleads\/client-sdk\/data\/|\bimport\s*(?:\(\s*)?["']@tearleads\/client-sdk\/data\//;

interface SourceMatch {
  filePath: string;
  line: string;
  lineNumber: number;
}

interface PackageJson {
  exports?: Record<string, unknown>;
}

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

async function findClientSdkDataPackageExports(): Promise<string[]> {
  const content = await readFile(clientSdkPackageJsonPath, "utf8");
  const packageJson = JSON.parse(content) as PackageJson;

  return Object.keys(packageJson.exports ?? {}).filter(
    (exportPath) => exportPath === "./data" || exportPath.startsWith("./data/"),
  );
}

async function findClientSdkDeepFacadePackageExports(): Promise<string[]> {
  const content = await readFile(clientSdkPackageJsonPath, "utf8");
  const packageJson = JSON.parse(content) as PackageJson;

  return Object.keys(packageJson.exports ?? {}).filter((exportPath) =>
    /^\.\/(?:stores|workflows)\/[^/]+\/.+/.test(exportPath),
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
const clientSdkDataPackageExports = await findClientSdkDataPackageExports();
const clientSdkDeepFacadePackageExports =
  await findClientSdkDeepFacadePackageExports();

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

process.exit(
  result.exitCode !== 0 ||
    appPresentationSqlExecutorReferences.length > 0 ||
    appReactFreeLayerReferences.length > 0 ||
    appProductionTestHelperReferences.length > 0 ||
    appProductionSdkDataImports.length > 0 ||
    appTestHelperSdkDataImports.length > 0 ||
    appTestSdkDataImports.length > 0 ||
    clientSdkDataPackageExports.length > 0 ||
    clientSdkDeepFacadePackageExports.length > 0
    ? 1
    : 0,
);
