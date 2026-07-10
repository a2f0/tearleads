import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

import { knipWorkspacePaths } from "../../knip.config";
import { dependencyCruiserEntryPoints } from "../dependencySourceRoots";
import {
  workspacePaths,
  workspaceRegistry,
  workspaceSourcePaths,
} from "../workspaceRegistry";

interface PackageJsonShape {
  readonly name?: unknown;
  readonly workspaces?: unknown;
}

interface TsConfigShape {
  readonly references?: ReadonlyArray<
    { readonly path?: unknown } | null | undefined
  >;
}

export interface WorkspaceRegistryViolation {
  readonly detail: string;
  readonly surface: string;
}

const intentionallyUnownedTypeScriptFiles = new Map([
  [
    "test/preload.ts",
    "Bun loads this root test hook; its API cleanup import belongs to the referenced packages/api project.",
  ],
]);

function parseJson<T>(source: string): T | undefined {
  try {
    const parsed: unknown = JSON.parse(source);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as T)
      : undefined;
  } catch {
    return undefined;
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  return [...duplicates].sort();
}

function compareLists(params: {
  actual: readonly string[];
  expected: readonly string[];
  surface: string;
}): WorkspaceRegistryViolation[] {
  const actual = new Set(params.actual);
  const expected = new Set(params.expected);
  const violations: WorkspaceRegistryViolation[] = [];

  for (const value of expected) {
    if (!actual.has(value)) {
      violations.push({
        detail: `is missing ${JSON.stringify(value)}`,
        surface: params.surface,
      });
    }
  }

  for (const value of actual) {
    if (!expected.has(value)) {
      violations.push({
        detail: `contains unregistered ${JSON.stringify(value)}`,
        surface: params.surface,
      });
    }
  }

  for (const value of duplicateValues(params.actual)) {
    violations.push({
      detail: `contains duplicate ${JSON.stringify(value)}`,
      surface: params.surface,
    });
  }

  return violations;
}

async function packageWorkspacePaths(): Promise<{
  paths: string[];
  violations: WorkspaceRegistryViolation[];
}> {
  const packageJson = parseJson<PackageJsonShape>(
    await readFile("package.json", "utf8"),
  );

  if (
    !packageJson ||
    !Array.isArray(packageJson.workspaces) ||
    !packageJson.workspaces.every((value) => typeof value === "string")
  ) {
    return {
      paths: [],
      violations: [
        {
          detail: "must be a string array",
          surface: "package.json#workspaces",
        },
      ],
    };
  }

  return { paths: packageJson.workspaces, violations: [] };
}

async function packageDirectoryPaths(): Promise<string[]> {
  const entries = await readdir("packages", { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(`packages/${entry.name}/package.json`),
    )
    .map((entry) => `packages/${entry.name}`)
    .sort();
}

async function tsconfigWorkspacePaths(): Promise<{
  paths: string[];
  violations: WorkspaceRegistryViolation[];
}> {
  const tsconfig = parseJson<TsConfigShape>(
    await readFile("tsconfig.json", "utf8"),
  );
  const referencePaths = tsconfig?.references?.map(
    (reference) => reference?.path,
  );

  if (
    !referencePaths ||
    !referencePaths.every((value) => typeof value === "string")
  ) {
    return {
      paths: [],
      violations: [
        {
          detail: "references must contain string paths",
          surface: "tsconfig.json",
        },
      ],
    };
  }

  const normalizedPaths = referencePaths.map((path) =>
    path.replace(/^\.\//, ""),
  );
  const violations = normalizedPaths.includes("tsconfig.tools.json")
    ? []
    : [
        {
          detail: 'is missing "tsconfig.tools.json"',
          surface: "tsconfig.json",
        },
      ];

  return {
    paths: normalizedPaths.filter((path) => path.startsWith("packages/")),
    violations,
  };
}

async function packageManifestViolations(): Promise<
  WorkspaceRegistryViolation[]
> {
  const violations = await Promise.all(
    workspaceRegistry.map(async (workspace) => {
      const manifestPath = `packages/${workspace.directory}/package.json`;
      if (!existsSync(manifestPath)) {
        return [
          {
            detail: "does not exist",
            surface: manifestPath,
          },
        ];
      }

      const manifest = parseJson<PackageJsonShape>(
        await readFile(manifestPath, "utf8"),
      );
      return manifest?.name === workspace.packageName
        ? []
        : [
            {
              detail: `name must be ${JSON.stringify(workspace.packageName)}, received ${JSON.stringify(manifest?.name)}`,
              surface: manifestPath,
            },
          ];
    }),
  );

  return violations.flat();
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function referencedTsconfigPaths(): string[] {
  const configFile = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  if (configFile.error) {
    return [];
  }

  const references =
    (configFile.config as TsConfigShape | null | undefined)?.references ?? [];
  return references.flatMap((reference) => {
    if (typeof reference?.path !== "string") {
      return [];
    }

    return [
      reference.path.endsWith(".json")
        ? reference.path
        : join(reference.path, "tsconfig.json"),
    ];
  });
}

function trackedTypeScriptFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((filePath) => /\.(?:[cm]?ts|tsx)$/.test(filePath))
    .sort();
}

function typeScriptProjectCoverageViolations(): WorkspaceRegistryViolation[] {
  const ownedFiles = new Set<string>();
  const violations: WorkspaceRegistryViolation[] = [];

  for (const configPath of referencedTsconfigPaths()) {
    const absoluteConfigPath = resolve(configPath);
    const configFile = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
    if (configFile.error) {
      violations.push({
        detail: ts.flattenDiagnosticMessageText(
          configFile.error.messageText,
          "\n",
        ),
        surface: configPath,
      });
      continue;
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(absoluteConfigPath),
      undefined,
      absoluteConfigPath,
    );
    for (const error of parsedConfig.errors) {
      violations.push({
        detail: ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        surface: configPath,
      });
    }
    for (const filePath of parsedConfig.fileNames) {
      ownedFiles.add(toPosixPath(relative(process.cwd(), resolve(filePath))));
    }
  }

  const trackedFiles = new Set(trackedTypeScriptFiles());
  for (const filePath of trackedFiles) {
    if (
      !ownedFiles.has(filePath) &&
      !intentionallyUnownedTypeScriptFiles.has(filePath)
    ) {
      violations.push({
        detail: "is not included by any root-referenced TypeScript project",
        surface: filePath,
      });
    }
  }

  for (const [filePath, reason] of intentionallyUnownedTypeScriptFiles) {
    if (!trackedFiles.has(filePath)) {
      violations.push({
        detail: "exception is stale because the file is no longer tracked",
        surface: filePath,
      });
    } else if (ownedFiles.has(filePath)) {
      violations.push({
        detail: `exception is no longer needed (${reason})`,
        surface: filePath,
      });
    }
  }

  return violations;
}

function registryDefinitionViolations(): WorkspaceRegistryViolation[] {
  const fields: ReadonlyArray<{
    field: string;
    values: readonly string[];
  }> = [
    {
      field: "directory",
      values: workspaceRegistry.map((workspace) => workspace.directory),
    },
    {
      field: "key",
      values: workspaceRegistry.map((workspace) => workspace.key),
    },
    {
      field: "packageName",
      values: workspaceRegistry.map((workspace) => workspace.packageName),
    },
  ];

  return fields.flatMap(({ field, values }) =>
    duplicateValues(values).map((value) => ({
      detail: `${field} ${JSON.stringify(value)} is duplicated`,
      surface: "scripts/workspaceRegistry.ts",
    })),
  );
}

export async function findWorkspaceRegistryViolations(): Promise<
  WorkspaceRegistryViolation[]
> {
  const [packageWorkspaces, packageDirectories, tsconfigWorkspaces] =
    await Promise.all([
      packageWorkspacePaths(),
      packageDirectoryPaths(),
      tsconfigWorkspacePaths(),
    ]);
  const expectedPaths = sortedUnique(workspacePaths);
  const expectedSourcePaths = sortedUnique(Object.values(workspaceSourcePaths));

  return [
    ...registryDefinitionViolations(),
    ...typeScriptProjectCoverageViolations(),
    ...packageWorkspaces.violations,
    ...tsconfigWorkspaces.violations,
    ...(await packageManifestViolations()),
    ...compareLists({
      actual: packageWorkspaces.paths,
      expected: expectedPaths,
      surface: "package.json#workspaces",
    }),
    ...compareLists({
      actual: packageDirectories,
      expected: expectedPaths,
      surface: "packages/*/package.json",
    }),
    ...compareLists({
      actual: tsconfigWorkspaces.paths,
      expected: expectedPaths,
      surface: "tsconfig.json#references",
    }),
    ...compareLists({
      actual: knipWorkspacePaths.base,
      expected: expectedPaths,
      surface: "knip.config.ts base workspaces",
    }),
    ...compareLists({
      actual: knipWorkspacePaths.production,
      expected: expectedPaths,
      surface: "knip.config.ts production workspaces",
    }),
    ...compareLists({
      actual: dependencyCruiserEntryPoints,
      expected: expectedSourcePaths,
      surface: "dependency-cruiser entry points",
    }),
  ];
}
