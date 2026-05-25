import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IConfiguration, ICruiseOptions } from "dependency-cruiser";
import { cruise } from "dependency-cruiser";
import * as ts from "typescript";

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
const appDocumentProjectionSourcePaths = new Set([
  "packages/app/src/document-types/projectors.ts",
]);
const appMiniAppBusSourcePath = "packages/app/src/mini-apps/bus.tsx";
const appProductionSourceEntryPoints = ["packages/app/src"];
const appTestSourceEntryPoints = ["packages/app/src"];
const appTestHelperEntryPoints = ["packages/app/test/helpers"];
const clientSdkSourceEntryPoints = ["packages/client-sdk/src"];
const clientSdkTestHelperEntryPoints = ["packages/client-sdk/test/helpers"];
const clientSdkPublicApiDocsPath = "docs/developer/client-sdk.md";
const clientSdkClientFacadeIndexPath =
  "packages/client-sdk/src/client/index.ts";
const clientSdkPackageJsonPath = "packages/client-sdk/package.json";
const clientSdkRootIndexPath = "packages/client-sdk/src/index.ts";
const clientSdkWorkflowDocsPath = "packages/client-sdk/src/workflows/README.md";
const clientSdkSupportedPackageExports = {
  ".": {
    default: "./dist/index.js",
    types: "./dist/index.d.ts",
  },
  "./sqlite": {
    default: "./dist/sqlite.js",
    types: "./dist/sqlite.d.ts",
  },
} as const;
const clientSdkRootWorkflowFacadeReExports = [
  "./workflows/blobs",
  "./workflows/container-contents",
  "./workflows/containers",
  "./workflows/documents",
  "./workflows/organizations",
  "./workflows/principals",
  "./workflows/registration",
  "./workflows/sync",
] as const;
const clientSdkRootAllowedReExports = new Set([
  "./client",
  "./documents",
  "./stores/container-contents",
  "./stores/documents",
  ...clientSdkRootWorkflowFacadeReExports,
]);
const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
const testFilePattern = /\.test\.[tj]sx?$/;
const rawSqlExecutorPattern = /\b(?:ExecSql|execSql)\b/;
const clientSdkPrefixedFacadeAliasPattern =
  /\bas\s+(?:Tearleads[A-Z][A-Za-z0-9_]*|TEARLEADS_[A-Z0-9_]+)/;
const clientSdkProductUiVocabularyPattern =
  /\b(?:Explorer|MiniApp|OrgManager|explorer|mini-apps?|org-manager)/;

type SourceFileLister = (dirPath: string) => Promise<string[]>;

interface ArchitectureCheckResult {
  failed: boolean;
  output: string;
}

interface ArchitectureCheck {
  run: () => Promise<ArchitectureCheckResult | undefined>;
}

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
  scripts?: Record<string, string>;
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

interface ClientSdkDocumentationContractViolation {
  detail: string;
  docsPath: string;
  entryName: string;
}

let clientSdkPackageJsonPromise: Promise<PackageJson> | undefined;

const clientSdkPackageStatusContract = {
  files: ["dist"],
  main: "./dist/index.js",
  name: "@tearleads/client-sdk",
  private: true,
  sideEffects: false,
  types: "./dist/index.d.ts",
  type: "module",
} as const;
const clientSdkPackageScriptContract = {
  build: "sh scripts/build.sh",
} as const;
const clientSdkForbiddenPackageFields = ["module"] as const;
const clientSdkPackageDependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function configToCruiseOptions(config: IConfiguration): ICruiseOptions {
  const { options = {}, ...ruleSet } = config;

  return {
    ...options,
    outputType: "err",
    ruleSet,
    validate: Object.keys(ruleSet).length > 0,
  };
}

function formatViolation(
  name: string,
  message: string,
  details: ReadonlyArray<string>,
): string {
  return [
    `error ${name}: ${message}`,
    ...details.map((detail) => `  ${detail}`),
  ].join("\n");
}

function hasJsonValue(actualValue: unknown, expectedValue: unknown): boolean {
  return JSON.stringify(actualValue) === JSON.stringify(expectedValue);
}

function createListCheck<T>(params: {
  findItems: () => Promise<ReadonlyArray<T>>;
  formatItem: (item: T) => string;
  message: string;
  name: string;
}): ArchitectureCheck {
  return {
    async run() {
      const items = await params.findItems();

      if (items.length === 0) {
        return undefined;
      }

      return {
        failed: true,
        output: formatViolation(
          params.name,
          params.message,
          items.map(params.formatItem),
        ),
      };
    },
  };
}

async function listSourceFiles(
  dirPath: string,
  includeFile: (filePath: string) => boolean,
): Promise<string[]> {
  const entries = (await readdir(dirPath, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listSourceFiles(entryPath, includeFile);
      }

      return includeFile(entryPath) ? [entryPath] : [];
    }),
  );

  return nestedFiles.flat();
}

async function listProductionSourceFiles(dirPath: string): Promise<string[]> {
  return listSourceFiles(
    dirPath,
    (filePath) =>
      productionSourceFilePattern.test(filePath) &&
      !testFilePattern.test(filePath),
  );
}

async function listTestSourceFiles(dirPath: string): Promise<string[]> {
  return listSourceFiles(dirPath, (filePath) => testFilePattern.test(filePath));
}

async function listAppPresentationSourceFiles(
  dirPath: string,
): Promise<string[]> {
  const productionSourceFiles = await listProductionSourceFiles(dirPath);
  return productionSourceFiles.filter(
    (filePath) => !appDocumentProjectionSourcePaths.has(filePath),
  );
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

async function listExactSourceFile(filePath: string): Promise<string[]> {
  return [filePath];
}

async function listedSourceFiles(
  entryPoints: ReadonlyArray<string>,
  listFiles: SourceFileLister,
): Promise<string[]> {
  const sourceFiles = (await Promise.all(entryPoints.map(listFiles))).flat();

  return [...new Set(sourceFiles)].sort();
}

async function findSourceTextMatches(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister;
  pattern: RegExp;
}): Promise<SourceMatch[]> {
  const sourceFiles = await listedSourceFiles(
    params.entryPoints,
    params.listFiles ?? listProductionSourceFiles,
  );
  const fileMatches = await Promise.all(
    sourceFiles.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      const codeOnlyContent = sourceTextWithoutComments(content, filePath);
      const originalLines = content.split("\n");

      return codeOnlyContent
        .split("\n")
        .flatMap((line, index): SourceMatch[] => {
          if (!matchesPattern(params.pattern, line)) {
            return [];
          }

          return [
            {
              filePath,
              line: originalLines[index] ?? line,
              lineNumber: index + 1,
            },
          ];
        });
    }),
  );

  return fileMatches.flat();
}

function sourceLanguageVariant(filePath: string): ts.LanguageVariant {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
}

function maskNonNewlineCharacters(
  characters: string[],
  start: number,
  end: number,
): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n" && characters[index] !== "\r") {
      characters[index] = " ";
    }
  }
}

function sourceTextWithoutComments(content: string, filePath: string): string {
  const characters = content.split("");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    sourceLanguageVariant(filePath),
    content,
  );
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      maskNonNewlineCharacters(
        characters,
        scanner.getTokenPos(),
        scanner.getTextPos(),
      );
    }

    token = scanner.scan();
  }

  return characters.join("");
}

function sourceScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith(".json")) {
    return ts.ScriptKind.JSON;
  }

  return ts.ScriptKind.TS;
}

function isStringModuleSpecifier(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function moduleSpecifierFromNode(
  node: ts.Node,
): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    isStringModuleSpecifier(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier;
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const [argument] = node.arguments;
    return argument && isStringModuleSpecifier(argument) ? argument : undefined;
  }

  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    isStringModuleSpecifier(node.argument.literal)
  ) {
    return node.argument.literal;
  }

  return undefined;
}

async function findModuleSpecifierMatches(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister;
  matches: (specifier: string) => boolean;
}): Promise<SourceMatch[]> {
  const sourceFiles = await listedSourceFiles(
    params.entryPoints,
    params.listFiles ?? listProductionSourceFiles,
  );
  const fileMatches = await Promise.all(
    sourceFiles.map((filePath) =>
      findFileModuleSpecifierMatches(filePath, params.matches),
    ),
  );

  return fileMatches.flat();
}

async function findFileModuleSpecifierMatches(
  filePath: string,
  matches: (specifier: string) => boolean,
): Promise<SourceMatch[]> {
  const content = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceScriptKind(filePath),
  );
  const lines = content.split("\n");
  const fileMatches: SourceMatch[] = [];

  function visit(node: ts.Node) {
    const moduleSpecifier = moduleSpecifierFromNode(node);
    if (moduleSpecifier && matches(moduleSpecifier.text)) {
      const location = sourceFile.getLineAndCharacterOfPosition(
        moduleSpecifier.getStart(sourceFile),
      );

      fileMatches.push({
        filePath,
        line: lines[location.line]?.trim() ?? moduleSpecifier.text,
        lineNumber: location.line + 1,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return fileMatches;
}

function sourceMatchDetail(match: SourceMatch): string {
  return `${match.filePath}:${match.lineNumber}: ${match.line.trim()}`;
}

function createSourceTextCheck(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister;
  message: string;
  name: string;
  pattern: RegExp;
}): ArchitectureCheck {
  return createListCheck({
    findItems: () =>
      findSourceTextMatches({
        entryPoints: params.entryPoints,
        listFiles: params.listFiles,
        pattern: params.pattern,
      }),
    formatItem: sourceMatchDetail,
    message: params.message,
    name: params.name,
  });
}

function createModuleSpecifierCheck(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister;
  matches: (specifier: string) => boolean;
  message: string;
  name: string;
}): ArchitectureCheck {
  return createListCheck({
    findItems: () =>
      findModuleSpecifierMatches({
        entryPoints: params.entryPoints,
        listFiles: params.listFiles,
        matches: params.matches,
      }),
    formatItem: sourceMatchDetail,
    message: params.message,
    name: params.name,
  });
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

async function findClientSdkPackageStatusViolations(): Promise<
  ClientSdkPackageStatusViolation[]
> {
  const packageJson = await readClientSdkPackageJson();
  const contractViolations = Object.entries(clientSdkPackageStatusContract)
    .map(([field, expectedValue]) => {
      const actualValue = packageJson[field as keyof PackageJson];

      return hasJsonValue(actualValue, expectedValue)
        ? undefined
        : {
            detail: `should be ${JSON.stringify(expectedValue)}`,
            field,
          };
    })
    .filter(
      (violation): violation is ClientSdkPackageStatusViolation =>
        violation !== undefined,
    );
  const scriptViolations = Object.entries(clientSdkPackageScriptContract)
    .map(([scriptName, expectedValue]) => {
      const actualValue = packageJson.scripts?.[scriptName];

      return hasJsonValue(actualValue, expectedValue)
        ? undefined
        : {
            detail: `should be ${JSON.stringify(expectedValue)}`,
            field: `scripts.${scriptName}`,
          };
    })
    .filter(
      (violation): violation is ClientSdkPackageStatusViolation =>
        violation !== undefined,
    );
  const forbiddenFieldViolations = clientSdkForbiddenPackageFields
    .filter((field) => Object.hasOwn(packageJson, field))
    .map((field) => ({
      detail: "should be omitted from the ESM export-map package contract",
      field,
    }));

  return [
    ...contractViolations,
    ...scriptViolations,
    ...forbiddenFieldViolations,
  ];
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

        return [{ declaredRange, dependencyName, dependencySection }];
      },
    );
  });
}

async function findClientSdkPackageExportContractViolations(): Promise<
  ClientSdkPackageExportContractViolation[]
> {
  const packageJson = await readClientSdkPackageJson();
  const packageExports = packageJson.exports ?? {};
  const missingOrChangedExports = Object.entries(
    clientSdkSupportedPackageExports,
  ).flatMap(([exportPath, expectedTarget]) =>
    expectedClientSdkExportViolations(
      packageExports[exportPath],
      exportPath,
      expectedTarget,
    ),
  );
  const unexpectedExports = Object.keys(packageExports)
    .filter(
      (exportPath) =>
        !Object.hasOwn(clientSdkSupportedPackageExports, exportPath),
    )
    .map((exportPath) => ({ detail: "unexpected", exportPath }));

  return [...missingOrChangedExports, ...unexpectedExports];
}

function expectedClientSdkExportViolations(
  exportTarget: unknown,
  exportPath: string,
  expectedTarget: { default: string; types: string },
): ClientSdkPackageExportContractViolation[] {
  if (!exportTarget) {
    return [{ detail: "missing", exportPath }];
  }

  const defaultTarget = packageExportConditionTarget(exportTarget, "default");
  const typesTarget = packageExportConditionTarget(exportTarget, "types");

  return [
    defaultTarget === expectedTarget.default
      ? undefined
      : {
          detail: `default target should be ${expectedTarget.default}`,
          exportPath,
        },
    typesTarget === expectedTarget.types
      ? undefined
      : {
          detail: `types target should be ${expectedTarget.types}`,
          exportPath,
        },
  ].filter(
    (violation): violation is ClientSdkPackageExportContractViolation =>
      violation !== undefined,
  );
}

function clientSdkPackageEntryPoint(exportPath: string): string {
  return exportPath === "."
    ? "@tearleads/client-sdk"
    : `@tearleads/client-sdk/${exportPath.slice(2)}`;
}

function expectedClientSdkPublicApiEntryPoints(): string[] {
  return Object.keys(clientSdkSupportedPackageExports).map(
    clientSdkPackageEntryPoint,
  );
}

function expectedClientSdkWorkflowFacadeNames(): string[] {
  return clientSdkRootWorkflowFacadeReExports.map((exportPath) =>
    exportPath.slice("./workflows/".length),
  );
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownSectionContent(
  markdownContent: string,
  heading: string,
): string | undefined {
  const headingPattern = new RegExp(
    `(?:^|\\n)##[ \\t]+${escapeRegExpLiteral(heading)}[ \\t]*(?:\\n|$)`,
  );
  const headingMatch = headingPattern.exec(markdownContent);

  if (!headingMatch) {
    return undefined;
  }

  const sectionContent = markdownContent.slice(
    headingMatch.index + headingMatch[0].length,
  );
  const nextHeading = /(?:^|\n)#{1,6}[ \t]+/.exec(sectionContent);

  return nextHeading
    ? sectionContent.slice(0, nextHeading.index)
    : sectionContent;
}

function markdownTableFirstColumnCodeValues(sectionContent: string): string[] {
  return sectionContent.split("\n").flatMap((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith("|")) {
      return [];
    }

    const [firstCell] = trimmedLine
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const codeSpan = firstCell ? /^`([^`]+)`$/.exec(firstCell) : undefined;

    return codeSpan?.[1] ? [codeSpan[1]] : [];
  });
}

function duplicateValues(values: ReadonlyArray<string>): string[] {
  const seenValues = new Set<string>();
  const duplicateValues = new Set<string>();

  for (const value of values) {
    if (seenValues.has(value)) {
      duplicateValues.add(value);
      continue;
    }

    seenValues.add(value);
  }

  return [...duplicateValues];
}

function findDocumentationContractViolations(params: {
  actualEntries: ReadonlyArray<string>;
  docsPath: string;
  expectedEntries: ReadonlyArray<string>;
}): ClientSdkDocumentationContractViolation[] {
  const actualEntrySet = new Set(params.actualEntries);
  const expectedEntrySet = new Set(params.expectedEntries);
  const missingEntries = params.expectedEntries
    .filter((entryName) => !actualEntrySet.has(entryName))
    .map((entryName) => ({
      detail: "missing",
      docsPath: params.docsPath,
      entryName,
    }));
  const unexpectedEntries = params.actualEntries
    .filter((entryName) => !expectedEntrySet.has(entryName))
    .map((entryName) => ({
      detail: "unexpected",
      docsPath: params.docsPath,
      entryName,
    }));
  const duplicatedEntries = duplicateValues(params.actualEntries).map(
    (entryName) => ({
      detail: "duplicated",
      docsPath: params.docsPath,
      entryName,
    }),
  );

  return [...missingEntries, ...unexpectedEntries, ...duplicatedEntries];
}

async function findClientSdkPublicApiDocsViolations(): Promise<
  ClientSdkDocumentationContractViolation[]
> {
  const docsContent = await readFile(clientSdkPublicApiDocsPath, "utf8");
  const publicApiSection = markdownSectionContent(
    docsContent,
    "Public API Entry Points",
  );

  if (!publicApiSection) {
    return [
      {
        detail: "section missing",
        docsPath: clientSdkPublicApiDocsPath,
        entryName: "Public API Entry Points",
      },
    ];
  }

  return findDocumentationContractViolations({
    actualEntries: markdownTableFirstColumnCodeValues(publicApiSection),
    docsPath: clientSdkPublicApiDocsPath,
    expectedEntries: expectedClientSdkPublicApiEntryPoints(),
  });
}

async function findClientSdkWorkflowTaxonomyDocsViolations(): Promise<
  ClientSdkDocumentationContractViolation[]
> {
  const docsContent = await readFile(clientSdkWorkflowDocsPath, "utf8");
  const workflowTaxonomySection = markdownSectionContent(
    docsContent,
    "Facade Taxonomy",
  );

  if (!workflowTaxonomySection) {
    return [
      {
        detail: "section missing",
        docsPath: clientSdkWorkflowDocsPath,
        entryName: "Facade Taxonomy",
      },
    ];
  }

  return findDocumentationContractViolations({
    actualEntries: markdownTableFirstColumnCodeValues(workflowTaxonomySection),
    docsPath: clientSdkWorkflowDocsPath,
    expectedEntries: expectedClientSdkWorkflowFacadeNames(),
  });
}

async function findClientSdkDataPackageExports(): Promise<string[]> {
  const packageJson = await readClientSdkPackageJson();

  return Object.keys(packageJson.exports ?? {}).filter(
    (exportPath) => exportPath === "./data" || exportPath.startsWith("./data/"),
  );
}

function isReactImport(specifier: string): boolean {
  return specifier === "react" || specifier.startsWith("react/");
}

function isAppTestHelperImport(specifier: string): boolean {
  return /(?:^|\/)test\/helpers(?:\/|$)/.test(specifier);
}

function isClientSdkDataImport(specifier: string): boolean {
  return (
    specifier === "@tearleads/client-sdk/data" ||
    specifier.startsWith("@tearleads/client-sdk/data/")
  );
}

function isClientSdkDocumentsImport(specifier: string): boolean {
  return (
    specifier === "@tearleads/client-sdk/documents" ||
    specifier.startsWith("@tearleads/client-sdk/documents/")
  );
}

function isClientSdkWorkflowImport(specifier: string): boolean {
  return (
    specifier === "@tearleads/client-sdk/workflows" ||
    specifier.startsWith("@tearleads/client-sdk/workflows/")
  );
}

function isClientSdkStoreImport(specifier: string): boolean {
  return (
    specifier === "@tearleads/client-sdk/stores" ||
    specifier.startsWith("@tearleads/client-sdk/stores/")
  );
}

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

function isAppMiniAppBusBoundaryImport(specifier: string): boolean {
  return (
    specifier.startsWith("@tearleads/") ||
    specifier.startsWith("../providers/") ||
    specifier.startsWith("../stores/") ||
    specifier.startsWith("../document-types/") ||
    /^\.\/(?:contacts|explorer|identity-manager|notes|org-manager)(?:\/|$)/.test(
      specifier,
    )
  );
}

async function runDependencyCruiserCheck(): Promise<ArchitectureCheckResult> {
  const result = await cruise(
    architectureEntryPoints,
    configToCruiseOptions(dependencyCruiserConfig),
  );
  const output =
    typeof result.output === "string" && result.output.trim().length > 0
      ? result.output.trim()
      : "";

  return { failed: result.exitCode !== 0, output };
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
  createModuleSpecifierCheck({
    entryPoints: [appMiniAppBusSourcePath],
    listFiles: listExactSourceFile,
    matches: isAppMiniAppBusBoundaryImport,
    message:
      "Mini-app bus should stay SDK-independent app window/message infrastructure; pass SDK-backed data, providers, stores, and concrete mini-app definitions in from callers.",
    name: "app-mini-app-bus-stays-sdk-independent",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkDataImport,
    message:
      "App production code should import client SDK contracts from @tearleads/client-sdk or @tearleads/client-sdk/sqlite instead of @tearleads/client-sdk/data/* internals.",
    name: "app-production-uses-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkDocumentsImport,
    message:
      "App production code should import public document contracts from @tearleads/client-sdk during the entrypoint consolidation migration.",
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
      "App test helpers should import client SDK contracts from @tearleads/client-sdk or @tearleads/client-sdk/sqlite instead of @tearleads/client-sdk/data/* internals.",
    name: "app-test-helpers-use-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestHelperEntryPoints,
    matches: isClientSdkDocumentsImport,
    message:
      "App test helpers should import public document contracts from @tearleads/client-sdk.",
    name: "app-test-helpers-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestHelperEntryPoints,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "App test helpers should import public store and workflow facade symbols from @tearleads/client-sdk.",
    name: "app-test-helpers-use-sdk-root-for-workflow-and-store-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkDataImport,
    message:
      "App tests should import client SDK contracts from @tearleads/client-sdk or @tearleads/client-sdk/sqlite instead of @tearleads/client-sdk/data/* internals.",
    name: "app-tests-use-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkDocumentsImport,
    message:
      "App tests should import public document contracts from @tearleads/client-sdk.",
    name: "app-tests-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "App tests should import public store and workflow facade symbols from @tearleads/client-sdk.",
    name: "app-tests-use-sdk-root-for-workflow-and-store-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkDocumentsImport,
    message:
      "Client SDK tests should import public document contracts from @tearleads/client-sdk.",
    name: "client-sdk-tests-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "Client SDK tests should import public store and workflow facade symbols from @tearleads/client-sdk.",
    name: "client-sdk-tests-use-sdk-root-for-workflow-and-store-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkTestHelperEntryPoints,
    matches: isClientSdkDocumentsImport,
    message:
      "Client SDK test helpers should import public document contracts from @tearleads/client-sdk.",
    name: "client-sdk-test-helpers-use-sdk-root-for-document-facade",
  }),
  createModuleSpecifierCheck({
    entryPoints: clientSdkTestHelperEntryPoints,
    matches: isClientSdkStoreOrWorkflowImport,
    message:
      "Client SDK test helpers should import public store and workflow facade symbols from @tearleads/client-sdk.",
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
      "Client SDK package exports should exactly match the documented root and SQLite entry points with explicit dist types and default targets.",
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
];

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

process.exit(checkResults.some((result) => result.failed) ? 1 : 0);
