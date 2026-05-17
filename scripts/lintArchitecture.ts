import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IConfiguration, ICruiseOptions } from "dependency-cruiser";
import { cruise } from "dependency-cruiser";

import dependencyCruiserConfig from "../dependency-cruiser.config";

const architectureEntryPoints = ["packages/api/src", "packages/app/src"];
const appPresentationEntryPoints = [
  "packages/app/src/components",
  "packages/app/src/document-types",
  "packages/app/src/mini-apps",
];
const appReactFreeLayerEntryPoints = [
  "packages/app/src/data",
  "packages/app/src/workflows",
];
const appProductionSourceEntryPoints = ["packages/app/src"];
const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
const testFilePattern = /\.test\.[tj]sx?$/;
const rawSqlExecutorPattern = /\b(?:ExecSql|execSql)\b/;
const reactImportPattern =
  /\bfrom\s*["']react(?:\/[^"']*)?["']|\bimport\s*(?:\(\s*)?["']react(?:\/[^"']*)?["']/;
const appTestHelperImportPattern =
  /\bfrom\s*["'][^"']*test\/helpers\/|\bimport\s*\(\s*["'][^"']*test\/helpers\//;

interface SourceMatch {
  filePath: string;
  line: string;
  lineNumber: number;
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

async function findSourceMatches(
  entryPoints: ReadonlyArray<string>,
  pattern: RegExp,
): Promise<SourceMatch[]> {
  const sourceFiles = (
    await Promise.all(entryPoints.map(listProductionSourceFiles))
  ).flat();
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

const result = await cruise(
  architectureEntryPoints,
  configToCruiseOptions(dependencyCruiserConfig),
);
const appPresentationSqlExecutorReferences =
  await findAppPresentationSqlExecutorReferences();
const appReactFreeLayerReferences = await findAppReactFreeLayerReferences();
const appProductionTestHelperReferences =
  await findAppProductionTestHelperReferences();

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

process.exit(
  result.exitCode !== 0 ||
    appPresentationSqlExecutorReferences.length > 0 ||
    appReactFreeLayerReferences.length > 0 ||
    appProductionTestHelperReferences.length > 0
    ? 1
    : 0,
);
