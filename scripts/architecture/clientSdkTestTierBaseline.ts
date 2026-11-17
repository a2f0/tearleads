// Shrink-only baseline for the client SDK test-tier rules in
// dependencyCruiserClientSdkRules.ts: each rule names the files it still
// exempts. A new violation fails the rule itself; an entry that no longer
// violates (or no longer exists) fails here, so the list only shrinks.
export const clientSdkTestTierBaselinePath =
  "scripts/architecture/clientSdkTestTierBaseline.json";

/** Rule name to the repo-relative files it exempts. */
export type ClientSdkTestTierBaseline = Readonly<
  Record<string, readonly string[]>
>;

/** A test-tier rule's `from` and `to` criteria, as dependency-cruiser regexes. */
export interface TestTierRuleTarget {
  readonly name: string;
  readonly from: { readonly path: string };
  readonly to: {
    readonly path: readonly string[];
    readonly pathNot: readonly string[];
  };
}

interface GraphDependency {
  readonly dependencyTypes: readonly string[];
  readonly resolved: string;
}

interface GraphModule {
  readonly dependencies: readonly GraphDependency[];
  readonly source: string;
}

interface DependencyGraph {
  readonly modules: readonly GraphModule[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Anchored `pathNot` patterns for the files a rule's baseline exempts. */
export function baselinedFilePatterns(
  baseline: ClientSdkTestTierBaseline,
  rule: string,
): string[] {
  return (baseline[rule] ?? []).map((file) => `^${escapeRegExp(file)}$`);
}

function matchesAny(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => new RegExp(pattern).test(path));
}

/** Whether `module` is in the rule's scope and has a runtime edge out of it. */
function violates(module: GraphModule, rule: TestTierRuleTarget): boolean {
  return (
    new RegExp(rule.from.path).test(module.source) &&
    module.dependencies.some(
      (dependency) =>
        !dependency.dependencyTypes.includes("type-only") &&
        matchesAny(rule.to.path, dependency.resolved) &&
        !matchesAny(rule.to.pathNot, dependency.resolved),
    )
  );
}

/** Files that break each rule, for generating the baseline. */
export function findTestTierViolators(
  graph: DependencyGraph,
  rules: readonly TestTierRuleTarget[],
): Record<string, string[]> {
  return Object.fromEntries(
    rules.map((rule) => [
      rule.name,
      graph.modules
        .filter((module) => violates(module, rule))
        .map((module) => module.source)
        .sort(),
    ]),
  );
}

export function findStaleTestTierBaselineEntries(
  graph: DependencyGraph,
  rules: readonly TestTierRuleTarget[],
  baseline: ClientSdkTestTierBaseline,
): string[] {
  const modules = new Map(
    graph.modules.map((module) => [module.source, module]),
  );
  const stale: string[] = [];
  for (const [ruleName, files] of Object.entries(baseline)) {
    const rule = rules.find((candidate) => candidate.name === ruleName);
    if (!rule) {
      stale.push(
        `${ruleName}: no such rule; delete it from ${clientSdkTestTierBaselinePath}`,
      );
      continue;
    }
    for (const file of files) {
      const module = modules.get(file);
      if (!module) {
        stale.push(
          `${file}: no longer exists; delete it from ${ruleName} in ${clientSdkTestTierBaselinePath}`,
        );
      } else if (!violates(module, rule)) {
        stale.push(
          `${file}: no longer breaks ${ruleName}; delete it from ${clientSdkTestTierBaselinePath}`,
        );
      }
    }
  }
  return stale;
}
