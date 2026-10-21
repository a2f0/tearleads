import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { listProductionSourceFiles } from "./checkFactories";
import {
  registeredSubsystemSourcePaths,
  type Subsystem,
  subsystems,
} from "./subsystems";
import {
  findTableUsesInSources,
  type SubsystemTableUse,
} from "./subsystemTableUses";

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
  const unknown = registry.flatMap((subsystem) =>
    (subsystem.tables ?? [])
      .filter((table) => !declared.has(table))
      .map((table) => `${subsystem.name}: table ${table} is not declared`),
  );
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
 * Uses of another subsystem's table that are not in the baseline, baseline
 * entries that no longer occur, and tables owned by no subsystem or several.
 */
export function findTableViolations(params: {
  baseline: SubsystemTableBaseline;
  declaredTables: readonly string[];
  registry: readonly Subsystem[];
  uses: readonly SubsystemTableUse[];
}): string[] {
  const crossUses = new Set<string>();
  const violations: string[] = [];
  for (const { from, table } of params.uses) {
    const owner = params.registry.find((subsystem) =>
      subsystem.tables?.includes(table),
    );
    const importer = ownerOfFile(params.registry, from);
    if (owner === undefined || importer === undefined || importer === owner) {
      continue;
    }
    crossUses.add(`${from} -> ${table}`);
    if (!params.baseline[table]?.includes(from)) {
      violations.push(`${from} uses ${table}, which ${owner.name} owns`);
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

async function readTableSources(): Promise<Map<string, ts.SourceFile>> {
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
    .filter((filePath) => {
      const owner = ownerOfFile(subsystems, filePath);
      return (
        owner !== undefined &&
        tablePackages.has(owner.package) &&
        !testSupportFilePattern.test(filePath)
      );
    });
  return new Map(
    await Promise.all(
      files.map(
        async (filePath) =>
          [
            filePath,
            ts.createSourceFile(
              filePath,
              await readFile(filePath, "utf8"),
              ts.ScriptTarget.Latest,
              true,
            ),
          ] as const,
      ),
    ),
  );
}

export async function findSubsystemTableViolations(): Promise<string[]> {
  const baseline = JSON.parse(
    await readFile(subsystemTableBaselinePath, "utf8"),
  ) as SubsystemTableBaseline;
  return findTableViolations({
    baseline,
    ...findTableUsesInSources(await readTableSources()),
    registry: subsystems,
  });
}
