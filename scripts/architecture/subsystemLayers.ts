import { readFile } from "node:fs/promises";
import { clientSdkLayers } from "./clientSdkLayers";
import { clientSdkSubsystems } from "./clientSdkSubsystems";
import {
  listSubsystemFiles,
  ownerOf,
  readImports,
  runtimeModuleSpecifiers,
  type SubsystemImport,
  type SubsystemImportBaseline,
} from "./subsystemImports";
import type { Subsystem, SubsystemLayers } from "./subsystemTypes";

export const subsystemLayerBaselinePath =
  "scripts/architecture/subsystemLayerBaseline.json";

interface LayerPosition {
  readonly layer: number;
  readonly rank: number;
}

function layerPositions(layers: SubsystemLayers): Map<string, LayerPosition> {
  const positions = new Map<string, LayerPosition>();
  layers.forEach((names, layer) => {
    for (const name of names) {
      if (!positions.has(name)) {
        positions.set(name, { layer, rank: positions.size });
      }
    }
  });
  return positions;
}

function manifestViolations(
  layers: SubsystemLayers,
  registry: readonly Subsystem[],
): string[] {
  const known = new Set(registry.map((subsystem) => subsystem.name));
  const seen = new Set<string>();
  const violations: string[] = [];
  for (const name of layers.flat()) {
    if (!known.has(name)) {
      violations.push(`subsystem layers name unknown subsystem ${name}`);
    } else if (seen.has(name)) {
      violations.push(`${name} appears more than once in the subsystem layers`);
    }
    seen.add(name);
  }
  for (const { name } of registry) {
    if (!seen.has(name)) {
      violations.push(`${name} has no subsystem layer`);
    }
  }
  return violations;
}

/**
 * Runtime imports into a subsystem that is not ranked below the importer's
 * and are not in the baseline, baseline entries that no longer occur, and
 * layer manifest errors. `registry` is the set of rows `layers` must cover.
 */
export function findLayerViolations(params: {
  baseline: SubsystemImportBaseline;
  imports: readonly SubsystemImport[];
  layers: SubsystemLayers;
  registry: readonly Subsystem[];
}): string[] {
  const positions = layerPositions(params.layers);
  const backEdges = new Set<string>();
  const violations: string[] = [];
  for (const { from, to } of params.imports) {
    const importer = ownerOf(params.registry, from);
    const target = ownerOf(params.registry, to);
    const importerPosition = importer && positions.get(importer.name);
    const targetPosition = target && positions.get(target.name);
    const edge = `${from} -> ${to}`;
    if (
      importerPosition === undefined ||
      targetPosition === undefined ||
      importer === target ||
      targetPosition.rank < importerPosition.rank ||
      backEdges.has(edge)
    ) {
      continue;
    }
    backEdges.add(edge);
    if (!params.baseline[to]?.includes(from)) {
      violations.push(
        `${from} imports ${to}, but ${importer?.name} (L${importerPosition.layer}) sits below ${target?.name} (L${targetPosition.layer}) in the subsystem layers`,
      );
    }
  }
  for (const [to, importers] of Object.entries(params.baseline)) {
    for (const from of importers) {
      if (!backEdges.has(`${from} -> ${to}`)) {
        violations.push(
          `${from} -> ${to} no longer occurs; delete it from ${subsystemLayerBaselinePath}`,
        );
      }
    }
  }
  return [
    ...violations.sort(),
    ...manifestViolations(params.layers, params.registry),
  ];
}

export async function findSubsystemLayerViolations(): Promise<string[]> {
  const files = await listSubsystemFiles(clientSdkSubsystems, () => true);
  const baseline = JSON.parse(
    await readFile(subsystemLayerBaselinePath, "utf8"),
  ) as SubsystemImportBaseline;
  return findLayerViolations({
    baseline,
    imports: await readImports(files, runtimeModuleSpecifiers),
    layers: clientSdkLayers,
    registry: clientSdkSubsystems,
  });
}
