import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import * as ts from "typescript";
import { listProductionSourceFiles } from "./checkFactories";
import { registeredSubsystemSourcePaths, subsystems } from "./subsystems";
import type { Subsystem } from "./subsystemTypes";

export const subsystemSurfaceBaselinePath =
  "scripts/architecture/subsystemSurfaceBaseline.json";

// Tests and their fixtures may reach into any subsystem.
const testSupportFilePattern = /\.(test|testFixtures|testUtils)\.[cm]?[tj]sx?$/;
const resolvableSuffixes = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** One import between two production files, as repository-relative paths. */
export interface SubsystemImport {
  from: string;
  to: string;
}

/** Deep imports that predate a surface: target file -> importing files. */
export type SubsystemSurfaceBaseline = Readonly<
  Record<string, readonly string[]>
>;

function matchesPath(filePath: string, path: string): boolean {
  return path.endsWith("/") ? filePath.startsWith(path) : filePath === path;
}

function ownerOf(
  registry: readonly Subsystem[],
  filePath: string,
): Subsystem | undefined {
  return registry.find((subsystem) =>
    subsystem.paths.some((path) => matchesPath(filePath, path)),
  );
}

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
  baseline: SubsystemSurfaceBaseline;
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

function resolveRelativeImport(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = normalize(join(dirname(from), specifier.replace(/\.js$/, "")));
  return [base, ...resolvableSuffixes.map((suffix) => `${base}${suffix}`)].find(
    (candidate) => files.has(candidate),
  );
}

async function listSurfaceCheckedFiles(): Promise<string[]> {
  const enforcedPackages = new Set(
    subsystems
      .filter((subsystem) => subsystem.surface !== undefined)
      .map((subsystem) => subsystem.package),
  );
  const fileGroups = await Promise.all(
    registeredSubsystemSourcePaths.map(listProductionSourceFiles),
  );
  return fileGroups.flat().filter((filePath) => {
    const owner = ownerOf(subsystems, filePath);
    return owner !== undefined && enforcedPackages.has(owner.package);
  });
}

async function readImports(
  files: readonly string[],
): Promise<SubsystemImport[]> {
  const knownFiles = new Set(files);
  const importers = files.filter(
    (filePath) => !testSupportFilePattern.test(filePath),
  );
  const perFile = await Promise.all(
    importers.map(async (from) => {
      const source = await readFile(from, "utf8");
      return ts
        .preProcessFile(source, true, true)
        .importedFiles.flatMap(({ fileName }) => {
          const to = resolveRelativeImport(from, fileName, knownFiles);
          return to === undefined || testSupportFilePattern.test(to)
            ? []
            : [{ from, to }];
        });
    }),
  );
  return perFile.flat();
}

export async function findSubsystemSurfaceViolations(): Promise<string[]> {
  const files = await listSurfaceCheckedFiles();
  const baseline = JSON.parse(
    await readFile(subsystemSurfaceBaselinePath, "utf8"),
  ) as SubsystemSurfaceBaseline;
  return findSurfaceViolations({
    baseline,
    files,
    imports: await readImports(files),
    registry: subsystems,
  });
}
