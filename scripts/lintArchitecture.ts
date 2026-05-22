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
const clientSdkPublicApiDocsPath = "docs/developer/client-sdk.md";
const clientSdkPackageJsonPath = "packages/client-sdk/package.json";
const clientSdkRootIndexPath = "packages/client-sdk/src/index.ts";
const clientSdkWorkflowDocsPath = "packages/client-sdk/src/workflows/README.md";
const clientSdkSupportedPackageExports = {
  ".": "./src/index.ts",
  "./documents": "./src/documents.ts",
  "./sqlite": "./src/sqlite.ts",
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
const clientSdkProductUiVocabularyPattern =
  /\b(?:Explorer|MiniApp|OrgManager|explorer|mini-apps?|org-manager)/;

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

function buildClientSdkDocumentationContractViolation(
  docsPath: string,
  entryName: string,
  detail: string,
): ClientSdkDocumentationContractViolation {
  return { detail, docsPath, entryName };
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
    .map((entryName) =>
      buildClientSdkDocumentationContractViolation(
        params.docsPath,
        entryName,
        "missing",
      ),
    );
  const unexpectedEntries = params.actualEntries
    .filter((entryName) => !expectedEntrySet.has(entryName))
    .map((entryName) =>
      buildClientSdkDocumentationContractViolation(
        params.docsPath,
        entryName,
        "unexpected",
      ),
    );
  const duplicatedEntries = duplicateValues(params.actualEntries).map(
    (entryName) =>
      buildClientSdkDocumentationContractViolation(
        params.docsPath,
        entryName,
        "duplicated",
      ),
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
      buildClientSdkDocumentationContractViolation(
        clientSdkPublicApiDocsPath,
        "Public API Entry Points",
        "section missing",
      ),
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
      buildClientSdkDocumentationContractViolation(
        clientSdkWorkflowDocsPath,
        "Facade Taxonomy",
        "section missing",
      ),
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
    "error app-production-uses-sdk-root-or-facades: App production code should import client SDK contracts from @tearleads/client-sdk or document/workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
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
    "error app-test-helpers-use-sdk-root-or-facades: App test helpers should import client SDK contracts from @tearleads/client-sdk or document/workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
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
    "error app-tests-use-sdk-root-or-facades: App tests should import client SDK contracts from @tearleads/client-sdk or document/workflow/store facades instead of @tearleads/client-sdk/data/* internals.",
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
    "error client-sdk-package-exports-match-supported-entry-points: Client SDK package exports should exactly match the documented root, document, workflow, and store facade entry points with explicit types and default targets.",
    ...violations.map(
      (violation) =>
        `  ${clientSdkPackageJsonPath}: ${violation.exportPath} ${violation.detail}`,
    ),
  ].join("\n");
}

function formatClientSdkPublicApiDocsViolations(
  violations: ReadonlyArray<ClientSdkDocumentationContractViolation>,
): string {
  if (violations.length === 0) {
    return "";
  }

  return [
    "error client-sdk-public-api-docs-match-package-exports: Client SDK public API docs should match the supported package export entry points exactly.",
    ...violations.map(
      (violation) =>
        `  ${violation.docsPath}: ${violation.entryName} ${violation.detail}`,
    ),
  ].join("\n");
}

function formatClientSdkWorkflowTaxonomyDocsViolations(
  violations: ReadonlyArray<ClientSdkDocumentationContractViolation>,
): string {
  if (violations.length === 0) {
    return "";
  }

  return [
    "error client-sdk-workflow-taxonomy-docs-match-package-exports: Client SDK workflow taxonomy docs should list each exported workflow facade exactly once.",
    ...violations.map(
      (violation) =>
        `  ${violation.docsPath}: ${violation.entryName} ${violation.detail}`,
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
const clientSdkPublicApiDocsViolations =
  await findClientSdkPublicApiDocsViolations();
const clientSdkWorkflowTaxonomyDocsViolations =
  await findClientSdkWorkflowTaxonomyDocsViolations();
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

const clientSdkPublicApiDocsOutput = formatClientSdkPublicApiDocsViolations(
  clientSdkPublicApiDocsViolations,
);
if (clientSdkPublicApiDocsOutput.length > 0) {
  console.error(clientSdkPublicApiDocsOutput);
}

const clientSdkWorkflowTaxonomyDocsOutput =
  formatClientSdkWorkflowTaxonomyDocsViolations(
    clientSdkWorkflowTaxonomyDocsViolations,
  );
if (clientSdkWorkflowTaxonomyDocsOutput.length > 0) {
  console.error(clientSdkWorkflowTaxonomyDocsOutput);
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
    clientSdkPublicApiDocsViolations.length > 0 ||
    clientSdkWorkflowTaxonomyDocsViolations.length > 0 ||
    clientSdkDataPackageExports.length > 0 ||
    clientSdkDeepFacadePackageExports.length > 0 ||
    clientSdkRootFacadeReExports.length > 0 ||
    clientSdkProductUiVocabularyReferences.length > 0
    ? 1
    : 0,
);
