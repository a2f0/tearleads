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
const appProductionSourceEntryPoints = ["packages/app/src"];
const appTestSourceEntryPoints = ["packages/app/src"];
const appTestHelperEntryPoints = ["packages/app/test/helpers"];
const clientSdkSourceEntryPoints = ["packages/client-sdk/src"];
const clientSdkPublicApiDocsPath = "docs/developer/client-sdk.md";
const clientSdkPackageJsonPath = "packages/client-sdk/package.json";
const clientSdkRootIndexPath = "packages/client-sdk/src/index.ts";
const clientSdkWorkflowDocsPath = "packages/client-sdk/src/workflows/README.md";
const clientSdkSupportedPackageExports = {
  ".": "./src/index.ts",
  "./documents": "./src/documents.ts",
  "./sqlite": "./src/sqlite.ts",
  "./stores/contacts": "./src/stores/contacts/index.ts",
  "./stores/container-contents": "./src/stores/container-contents/index.ts",
  "./stores/documents": "./src/stores/documents/index.ts",
  "./workflows/blobs": "./src/workflows/blobs/index.ts",
  "./workflows/contacts": "./src/workflows/contacts/index.ts",
  "./workflows/containers": "./src/workflows/containers/index.ts",
  "./workflows/documents": "./src/workflows/documents/index.ts",
  "./workflows/container-contents":
    "./src/workflows/container-contents/index.ts",
  "./workflows/organizations": "./src/workflows/organizations/index.ts",
  "./workflows/principals": "./src/workflows/principals/index.ts",
  "./workflows/registration": "./src/workflows/registration/index.ts",
  "./workflows/sync": "./src/workflows/sync/index.ts",
} as const;
const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
const testFilePattern = /\.test\.[tj]sx?$/;
const rawSqlExecutorPattern = /\b(?:ExecSql|execSql)\b/;
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

async function listExactSourceFile(filePath: string): Promise<string[]> {
  return [filePath];
}

function isCommentOnlyLine(line: string): boolean {
  const trimmedLine = line.trimStart();
  return (
    trimmedLine.startsWith("//") ||
    trimmedLine.startsWith("/*") ||
    trimmedLine.startsWith("*")
  );
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
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

      return content.split("\n").flatMap((line, index): SourceMatch[] => {
        if (isCommentOnlyLine(line) || !matchesPattern(params.pattern, line)) {
          return [];
        }

        return [{ filePath, line, lineNumber: index + 1 }];
      });
    }),
  );

  return fileMatches.flat();
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

      return actualValue === expectedValue
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
  const artifactFieldViolations = clientSdkSourceOnlyArtifactFields
    .filter((field) => Object.hasOwn(packageJson, field))
    .map((field) => ({
      detail:
        "should be omitted while package exports target TypeScript source files",
      field,
    }));

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
  expectedTarget: string,
): ClientSdkPackageExportContractViolation[] {
  if (!exportTarget) {
    return [{ detail: "missing", exportPath }];
  }

  const defaultTarget = packageExportConditionTarget(exportTarget, "default");
  const typesTarget = packageExportConditionTarget(exportTarget, "types");

  return [
    defaultTarget === expectedTarget
      ? undefined
      : {
          detail: `default target should be ${expectedTarget}`,
          exportPath,
        },
    typesTarget === expectedTarget
      ? undefined
      : {
          detail: `types target should be ${expectedTarget}`,
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
  return Object.keys(clientSdkSupportedPackageExports).flatMap((exportPath) => {
    const workflowExport = /^\.\/workflows\/([^/]+)$/.exec(exportPath);

    return workflowExport?.[1] ? [workflowExport[1]] : [];
  });
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

async function findClientSdkDeepFacadePackageExports(): Promise<string[]> {
  const packageJson = await readClientSdkPackageJson();

  return Object.keys(packageJson.exports ?? {}).filter((exportPath) =>
    /^\.\/(?:stores|workflows)\/[^/]+\/.+/.test(exportPath),
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

function isClientSdkRootFacadeReExport(specifier: string): boolean {
  return /^\.\/(?:stores|workflows)(?:\/|$)/.test(specifier);
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
    entryPoints: appProductionSourceEntryPoints,
    matches: isClientSdkDataImport,
    message:
      "App production code should import client SDK contracts from @tearleads/client-sdk or document/workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
    name: "app-production-uses-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestHelperEntryPoints,
    matches: isClientSdkDataImport,
    message:
      "App test helpers should import client SDK contracts from @tearleads/client-sdk or document/workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
    name: "app-test-helpers-use-sdk-root-or-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: appTestSourceEntryPoints,
    listFiles: listTestSourceFiles,
    matches: isClientSdkDataImport,
    message:
      "App tests should import client SDK contracts from @tearleads/client-sdk or document/workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
    name: "app-tests-use-sdk-root-or-facades",
  }),
  createListCheck({
    findItems: findClientSdkPackageStatusViolations,
    formatItem: (violation) =>
      `${clientSdkPackageJsonPath}: ${violation.field} ${violation.detail}`,
    message:
      "Client SDK package metadata should match the documented private, source-consumed package contract until an external release build exists.",
    name: "client-sdk-package-status-stays-private-source-consumed",
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
      "Client SDK package exports should exactly match the documented root, document, workflow, and store facade entry points with explicit types and default targets.",
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
      "Client SDK data internals should stay package-internal; promote contracts through the root or explicit workflow/store facades instead.",
    name: "client-sdk-does-not-export-data-internals",
  }),
  createListCheck({
    findItems: findClientSdkDeepFacadePackageExports,
    formatItem: (exportPath) => `${clientSdkPackageJsonPath}: ${exportPath}`,
    message:
      "Client SDK package exports should stay at the root or workflow/store facade level instead of exposing implementation files.",
    name: "client-sdk-exports-only-root-and-facades",
  }),
  createModuleSpecifierCheck({
    entryPoints: [clientSdkRootIndexPath],
    listFiles: listExactSourceFile,
    matches: isClientSdkRootFacadeReExport,
    message:
      "Client SDK root exports should stay focused on neutral contracts; workflow and store APIs belong behind explicit facade subpaths.",
    name: "client-sdk-root-exports-neutral-contracts",
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
