import type { RunClientSql } from "../canaries/report";
import type { Range } from "../canaries/summary";
import type { StatementSummary } from "../statements/summary";
import type { ScenarioHttpSummary } from "./httpCapture";

export interface ScenarioSample {
  readonly scenario: string;
  readonly status: "passed" | "failed" | "timed-out" | "unprofiled";
  readonly wallMs: number;
  readonly http: ScenarioHttpSummary | null;
  readonly statements:
    | { readonly status: "off" }
    | { readonly status: "missing"; readonly capture: string }
    | {
        readonly status: "captured";
        readonly capture: string;
        readonly summary: StatementSummary;
      };
  readonly clientSql?: RunClientSql;
}

export interface ScenarioRouteSummary {
  readonly count: Range;
  readonly conflicts: Range;
  readonly requestBytes: Range;
  readonly responseBytes: Range;
}

export interface ScenarioSummary {
  readonly scenario: string;
  readonly samples: number;
  readonly wallMs: Range;
  readonly requests: Range;
  readonly conflicts: Range;
  readonly requestBytes: Range;
  readonly responseBytes: Range;
  readonly serverMs: Range;
  readonly manifestCitations: Range;
  readonly apiStatements: Range | null;
  readonly pureReadRepeats: Range | null;
  readonly clientStatements: Range | null;
  readonly byRoute: Readonly<Record<string, ScenarioRouteSummary>>;
  readonly operations: Readonly<Record<string, number>>;
  readonly errorCodes: Readonly<Record<string, number>>;
}

export interface ScenarioRouteChange {
  readonly route: string;
  readonly before: ScenarioRouteSummary;
  readonly after: ScenarioRouteSummary;
}

export interface ScenarioChange {
  readonly scenario: string;
  readonly before: ScenarioSummary | null;
  readonly after: ScenarioSummary | null;
  readonly routes: readonly ScenarioRouteChange[];
}

function range(values: readonly number[]): Range {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function capturedRange(counts: readonly (number | undefined)[]): Range | null {
  const captured = counts.filter((count) => count !== undefined);
  return captured.length === counts.length && captured.length > 0
    ? range(captured)
    : null;
}

function sortedKeys(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function pureRepeatsTotal(run: ScenarioSample): number | undefined {
  if (run.statements.status !== "captured") return undefined;
  const { summary } = run.statements;
  if (!summary.paramHashes) return undefined;
  if (summary.routes.length > 0) {
    return summary.routes.reduce(
      (sum, route) => sum + (route.pureReadRepeats ?? 0),
      0,
    );
  }
  let total = 0;
  for (const label of summary.labels) {
    for (const repeat of label.pureReadRepeats ?? []) {
      total += repeat.count;
    }
  }
  return total;
}

function mergeMaxCounts(
  maps: readonly Readonly<Record<string, number>>[],
): Record<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      merged.set(key, Math.max(merged.get(key) ?? 0, value));
    }
  }
  return Object.fromEntries(
    [...merged.entries()].sort(
      ([aKey, aVal], [bKey, bVal]) =>
        bVal - aVal || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0),
    ),
  );
}

/** Groups passing scenario runs by name and reduces metrics to min..max ranges. */
export function summarizeScenarios(
  runs: readonly ScenarioSample[],
): ScenarioSummary[] {
  const groups = new Map<string, ScenarioSample[]>();
  for (const run of runs) {
    if (run.status !== "passed" || !run.http) continue;
    const list = groups.get(run.scenario) ?? [];
    list.push(run);
    groups.set(run.scenario, list);
  }
  return [...groups.entries()].map(([scenario, group]) => {
    const https = group.flatMap((run) => (run.http ? [run.http] : []));
    const allRoutes = sortedKeys(
      https.flatMap((http) => Object.keys(http.byRoute)),
    );
    return {
      scenario,
      samples: group.length,
      wallMs: range(group.map((run) => run.wallMs)),
      requests: range(https.map((http) => http.requests)),
      conflicts: range(https.map((http) => http.conflicts)),
      requestBytes: range(https.map((http) => http.requestBytes)),
      responseBytes: range(https.map((http) => http.responseBytes)),
      serverMs: range(https.map((http) => http.serverMs)),
      manifestCitations: range(https.map((http) => http.manifestCitations)),
      apiStatements: capturedRange(
        group.map((run) =>
          run.statements.status === "captured"
            ? run.statements.summary.statements
            : undefined,
        ),
      ),
      pureReadRepeats: capturedRange(group.map(pureRepeatsTotal)),
      clientStatements: capturedRange(
        group.map((run) =>
          run.clientSql?.status === "captured"
            ? run.clientSql.summary.statements
            : undefined,
        ),
      ),
      byRoute: Object.fromEntries(
        allRoutes.map((route) => {
          const entries = https.map((http) => http.byRoute[route]);
          return [
            route,
            {
              count: range(entries.map((entry) => entry?.count ?? 0)),
              conflicts: range(entries.map((entry) => entry?.conflicts ?? 0)),
              requestBytes: range(
                entries.map((entry) => entry?.requestBytes ?? 0),
              ),
              responseBytes: range(
                entries.map((entry) => entry?.responseBytes ?? 0),
              ),
            },
          ];
        }),
      ),
      operations: mergeMaxCounts(https.map((http) => http.operations)),
      errorCodes: mergeMaxCounts(https.map((http) => http.errorCodes)),
    };
  });
}

const zero: Range = { min: 0, max: 0 };
const absentRoute: ScenarioRouteSummary = {
  count: zero,
  conflicts: zero,
  requestBytes: zero,
  responseBytes: zero,
};
const sameRange = (a: Range, b: Range) => a.min === b.min && a.max === b.max;
const sameRoute = (a: ScenarioRouteSummary, b: ScenarioRouteSummary) =>
  sameRange(a.count, b.count) &&
  sameRange(a.conflicts, b.conflicts) &&
  sameRange(a.requestBytes, b.requestBytes) &&
  sameRange(a.responseBytes, b.responseBytes);

/** Pairs scenario summaries by name; unmatched scenarios pair with null. */
export function compareScenarios(
  before: readonly ScenarioSummary[],
  after: readonly ScenarioSummary[],
): ScenarioChange[] {
  const afterByName = new Map(after.map((item) => [item.scenario, item]));
  const beforeNames = new Set(before.map((item) => item.scenario));
  const pairs: [ScenarioSummary | null, ScenarioSummary | null][] = [
    ...before.map((item): [ScenarioSummary, ScenarioSummary | null] => [
      item,
      afterByName.get(item.scenario) ?? null,
    ]),
    ...after
      .filter((item) => !beforeNames.has(item.scenario))
      .map((item): [null, ScenarioSummary] => [null, item]),
  ];
  return pairs.map(([was, now]) => {
    const scenario = (now ?? was)?.scenario;
    if (!scenario) throw new Error("A scenario pair is empty.");
    const routes = sortedKeys([
      ...Object.keys(was?.byRoute ?? {}),
      ...Object.keys(now?.byRoute ?? {}),
    ]);
    return {
      scenario,
      before: was,
      after: now,
      routes: routes
        .map((route) => ({
          route,
          before: was?.byRoute[route] ?? absentRoute,
          after: now?.byRoute[route] ?? absentRoute,
        }))
        .filter((change) => !sameRoute(change.before, change.after)),
    };
  });
}

/** Whether a pair changed in requests, conflicts, bytes, SQL counts, or presence. */
export function scenarioChanged(change: ScenarioChange): boolean {
  const { before, after } = change;
  if (!before || !after) return true;
  return (
    change.routes.length > 0 ||
    !sameRange(before.requests, after.requests) ||
    !sameRange(before.conflicts, after.conflicts) ||
    !sameRange(before.requestBytes, after.requestBytes) ||
    !sameRange(before.responseBytes, after.responseBytes) ||
    (before.apiStatements !== null &&
      after.apiStatements !== null &&
      !sameRange(before.apiStatements, after.apiStatements)) ||
    (before.pureReadRepeats !== null &&
      after.pureReadRepeats !== null &&
      !sameRange(before.pureReadRepeats, after.pureReadRepeats)) ||
    (before.clientStatements !== null &&
      after.clientStatements !== null &&
      !sameRange(before.clientStatements, after.clientStatements))
  );
}
