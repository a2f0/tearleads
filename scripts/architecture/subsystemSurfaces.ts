import { readFile } from "node:fs/promises";
import {
  allModuleSpecifiers,
  listSubsystemFiles,
  matchesPath,
  ownerOf,
  readImports,
  type SubsystemImport,
  type SubsystemImportBaseline,
} from "./subsystemImports";
import { subsystems } from "./subsystems";
import type { Subsystem } from "./subsystemTypes";

export const subsystemSurfaceBaselinePath =
  "scripts/architecture/subsystemSurfaceBaseline.json";

function isOutsideSurface(
  importer: Subsystem | undefined,
  target: Subsystem | undefined,
  filePath: string,
): target is Subsystem & { surface: readonly string[] } {
  return (
    target?.surface !== undefined &&
    importer !== undefined &&
    importer !== target &&
    !target.surface.some((path) => matchesPath(filePath, path))
  );
}

function unmatchedSurfaceEntries(
  registry: readonly Subsystem[],
  files: readonly string[],
): string[] {
  return registry.flatMap((subsystem) =>
    (subsystem.surface ?? []).flatMap((entry) => {
      const owned = subsystem.paths.some((path) =>
        entry.endsWith("/") ? entry.startsWith(path) : matchesPath(entry, path),
      );
      if (!owned) {
        return [
          `${subsystem.name}: surface entry ${entry} is outside its paths`,
        ];
      }
      return files.some((filePath) => matchesPath(filePath, entry))
        ? []
        : [`${subsystem.name}: surface entry ${entry} matches no file`];
    }),
  );
}

/**
 * Imports that enter another subsystem outside its declared surface and are
 * not in the baseline, baseline entries that no longer occur, and surface
 * entries that name nothing in their subsystem.
 */
export function findSurfaceViolations(params: {
  baseline: SubsystemImportBaseline;
  files: readonly string[];
  imports: readonly SubsystemImport[];
  registry: readonly Subsystem[];
}): string[] {
  const deepImports = new Set<string>();
  const violations: string[] = [];
  for (const { from, to } of params.imports) {
    const target = ownerOf(params.registry, to);
    if (!isOutsideSurface(ownerOf(params.registry, from), target, to)) {
      continue;
    }
    deepImports.add(`${from} -> ${to}`);
    if (!params.baseline[to]?.includes(from)) {
      violations.push(
        `${from} imports ${to}, which is outside ${target.name}'s surface`,
      );
    }
  }
  for (const [to, importers] of Object.entries(params.baseline)) {
    for (const from of importers) {
      if (!deepImports.has(`${from} -> ${to}`)) {
        violations.push(
          `${from} -> ${to} no longer occurs; delete it from ${subsystemSurfaceBaselinePath}`,
        );
      }
    }
  }
  return [
    ...violations.sort(),
    ...unmatchedSurfaceEntries(params.registry, params.files),
  ];
}

async function listSurfaceCheckedFiles(): Promise<string[]> {
  const enforcedPackages = new Set(
    subsystems
      .filter((subsystem) => subsystem.surface !== undefined)
      .map((subsystem) => subsystem.package),
  );
  return listSubsystemFiles(subsystems, (owner) =>
    enforcedPackages.has(owner.package),
  );
}

export async function findSubsystemSurfaceViolations(): Promise<string[]> {
  const files = await listSurfaceCheckedFiles();
  const baseline = JSON.parse(
    await readFile(subsystemSurfaceBaselinePath, "utf8"),
  ) as SubsystemImportBaseline;
  return findSurfaceViolations({
    baseline,
    files,
    imports: await readImports(files, allModuleSpecifiers),
    registry: subsystems,
  });
}
