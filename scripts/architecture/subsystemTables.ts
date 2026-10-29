import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { listProductionSourceFiles } from "./checkFactories";
import { registeredSubsystemSourcePaths, subsystems } from "./subsystems";
import {
  findTableUsesInProgram,
  type SubsystemTableUse,
} from "./subsystemTableUses";
import type { Subsystem } from "./subsystemTypes";

export const subsystemTableBaselinePath =
  "scripts/architecture/subsystemTableBaseline.json";

const testSupportFilePattern = /\.(test|testFixtures|testUtils)\.[cm]?[tj]sx?$/;

/** Table uses that predate ownership: table name -> importing files. */
export type SubsystemTableBaseline = Readonly<
  Record<string, readonly string[]>
>;

function matchesPath(filePath: string, path: string): boolean {
  return path.endsWith("/") ? filePath.startsWith(path) : filePath === path;
}

function ownerOfFile(
  registry: readonly Subsystem[],
  filePath: string,
): Subsystem | undefined {
  return registry.find((subsystem) =>
    subsystem.paths.some((path) => matchesPath(filePath, path)),
  );
}

function tableOwnershipViolations(
  registry: readonly Subsystem[],
  declaredTables: readonly string[],
): string[] {
  const declared = new Set(declaredTables);
  const unknown = registry.flatMap((subsystem) => [
    ...(subsystem.tables ?? [])
      .filter((table) => !declared.has(table))
      .map((table) => `${subsystem.name}: table ${table} is not declared`),
    ...(subsystem.readableTables ?? [])
      .filter((table) => !subsystem.tables?.includes(table))
      .map(
        (table) =>
          `${subsystem.name}: readable table ${table} is not one of its tables`,
      ),
  ]);
  const owners = declaredTables.flatMap((table) => {
    const owning = registry.filter((subsystem) =>
      subsystem.tables?.includes(table),
    );
    if (owning.length === 1) return [];
    return owning.length === 0
      ? [`table ${table} is owned by no subsystem`]
      : [
          `table ${table} is owned by several subsystems (${owning.map((subsystem) => subsystem.name).join(", ")})`,
        ];
  });
  return [...unknown, ...owners];
}

/**
 * Writes to another subsystem's table and reads of one it does not expose
 * that are not in the baseline, baseline entries that no longer occur, and
 * tables owned by no subsystem or several.
 */
export function findTableViolations(params: {
  baseline: SubsystemTableBaseline;
  declaredTables: readonly string[];
  registry: readonly Subsystem[];
  uses: readonly SubsystemTableUse[];
}): string[] {
  const crossUses = new Set<string>();
  const violations: string[] = [];
  for (const { access, from, table } of params.uses) {
    const owner = params.registry.find((subsystem) =>
      subsystem.tables?.includes(table),
    );
    const importer = ownerOfFile(params.registry, from);
    if (
      owner === undefined ||
      importer === undefined ||
      importer === owner ||
      (access === "read" && owner.readableTables?.includes(table))
    ) {
      continue;
    }
    crossUses.add(`${from} -> ${table}`);
    if (!params.baseline[table]?.includes(from)) {
      violations.push(
        access === "write"
          ? `${from} writes ${table}, which ${owner.name} owns`
          : `${from} reads ${table}, which ${owner.name} does not expose for reading`,
      );
    }
  }
  for (const [table, importers] of Object.entries(params.baseline)) {
    for (const from of importers) {
      if (!crossUses.has(`${from} -> ${table}`)) {
        violations.push(
          `${from} -> ${table} no longer occurs; delete it from ${subsystemTableBaselinePath}`,
        );
      }
    }
  }
  return [
    ...violations.sort(),
    ...tableOwnershipViolations(params.registry, params.declaredTables),
  ];
}

/**
 * The table uses in each package whose subsystems own tables, read with a
 * type-checked program over the package's production files and tsconfig.
 */
async function readTableUses(): Promise<{
  declaredTables: string[];
  uses: SubsystemTableUse[];
}> {
  const tablePackages = new Set(
    subsystems
      .filter((subsystem) => subsystem.tables !== undefined)
      .map((subsystem) => subsystem.package),
  );
  const files = (
    await Promise.all(
      registeredSubsystemSourcePaths.map(listProductionSourceFiles),
    )
  )
    .flat()
    .filter((filePath) => !testSupportFilePattern.test(filePath));
  const results = [...tablePackages].map((tablePackage) => {
    const packageFiles = files.filter(
      (filePath) => ownerOfFile(subsystems, filePath)?.package === tablePackage,
    );
    const config = ts.getParsedCommandLineOfConfigFile(
      `packages/${tablePackage}/tsconfig.json`,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );
    const program = ts.createProgram(packageFiles, {
      ...config?.options,
      noEmit: true,
    });
    return findTableUsesInProgram(program, packageFiles);
  });
  return {
    declaredTables: results.flatMap((result) => result.declaredTables),
    uses: results.flatMap((result) => result.uses),
  };
}

export async function findSubsystemTableViolations(): Promise<string[]> {
  const baseline = JSON.parse(
    await readFile(subsystemTableBaselinePath, "utf8"),
  ) as SubsystemTableBaseline;
  return findTableViolations({
    baseline,
    ...(await readTableUses()),
    registry: subsystems,
  });
}
