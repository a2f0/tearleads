import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

/** `packages/bob-and-alice`, where the multi-party keying scenarios live. */
export const bobAndAliceRoot = resolve(
  import.meta.dir,
  "../../../bob-and-alice",
);

export interface Scenario {
  /** The file's base name without `.test.ts`, as reports and filters use it. */
  readonly name: string;
  /** Relative to `packages/bob-and-alice`. */
  readonly file: string;
}

function scenarioName(file: string): string {
  return basename(file).replace(/\.test\.ts$/u, "");
}

/** Every end-to-end scenario file under `packages/bob-and-alice/src/scenarios`. */
export async function discoverScenarios(
  root = bobAndAliceRoot,
): Promise<Scenario[]> {
  const dir = resolve(root, "src/scenarios");
  const files = await readdir(dir);
  const scenarios: Scenario[] = [];
  for (const name of files) {
    if (!/\.test\.ts$/u.test(name)) continue;
    const file = `src/scenarios/${name}`;
    scenarios.push({ name: scenarioName(file), file });
  }
  if (scenarios.length === 0) {
    throw new Error(`No scenario test files found under ${dir}.`);
  }
  return scenarios.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * Keeps the scenarios whose name contains any filter, ignoring case. Every
 * filter must match at least one scenario, so a typo fails instead of
 * silently profiling less.
 */
export function selectScenarios(
  scenarios: readonly Scenario[],
  filters: readonly string[],
): Scenario[] {
  if (filters.length === 0) return [...scenarios];
  const matches = (scenario: Scenario, filter: string) =>
    scenario.name.toLowerCase().includes(filter.toLowerCase());
  for (const filter of filters) {
    if (!scenarios.some((scenario) => matches(scenario, filter))) {
      throw new Error(
        `No scenario matches "${filter}". Scenarios: ${scenarios.map((scenario) => scenario.name).join(", ")}.`,
      );
    }
  }
  return scenarios.filter((scenario) =>
    filters.some((filter) => matches(scenario, filter)),
  );
}
