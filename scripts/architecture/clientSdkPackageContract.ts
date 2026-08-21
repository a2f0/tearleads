import { readFile } from "node:fs/promises";

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

export const clientSdkPackageJsonPath = "packages/client-sdk/package.json";
const clientSdkPublicApiDocsPath = "docs/developer/client-sdk.md";
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
  "./testing": {
    default: "./dist/data/trustedUserIdentity/testFixtures.js",
    types: "./dist/data/trustedUserIdentity/testFixtures.d.ts",
  },
} as const;
export const clientSdkRootWorkflowFacadeReExports = [
  "./workflows/blobs",
  "./workflows/container-contents",
  "./workflows/containers",
  "./workflows/documents",
  "./workflows/organizations",
  "./workflows/principals",
  "./workflows/registration",
  "./workflows/sync",
] as const;

let clientSdkPackageJsonPromise: Promise<PackageJson> | undefined;

const clientSdkPackageStatusContract = {
  files: ["dist"],
  main: "./dist/index.js",
  name: "@symcrypt/client-sdk",
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

function hasJsonValue(actualValue: unknown, expectedValue: unknown): boolean {
  return JSON.stringify(actualValue) === JSON.stringify(expectedValue);
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

export async function findClientSdkPackageStatusViolations(): Promise<
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

export async function findClientSdkWorkspaceDependencyViolations(): Promise<
  ClientSdkWorkspaceDependencyViolation[]
> {
  const packageJson = await readClientSdkPackageJson();

  return clientSdkPackageDependencySections.flatMap((dependencySection) => {
    const dependencies = packageJson[dependencySection] ?? {};

    return Object.entries(dependencies).flatMap(
      ([dependencyName, declaredRange]) => {
        if (
          !dependencyName.startsWith("@symcrypt/") ||
          declaredRange === "workspace:*"
        ) {
          return [];
        }

        return [{ declaredRange, dependencyName, dependencySection }];
      },
    );
  });
}

export async function findClientSdkPackageExportContractViolations(): Promise<
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
    ? "@symcrypt/client-sdk"
    : `@symcrypt/client-sdk/${exportPath.slice(2)}`;
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

export async function findClientSdkPublicApiDocsViolations(): Promise<
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

export async function findClientSdkWorkflowTaxonomyDocsViolations(): Promise<
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

export async function findClientSdkDataPackageExports(): Promise<string[]> {
  const packageJson = await readClientSdkPackageJson();

  return Object.keys(packageJson.exports ?? {}).filter(
    (exportPath) => exportPath === "./data" || exportPath.startsWith("./data/"),
  );
}
