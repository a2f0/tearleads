import { median } from "../median";
import type { ReloadMeasurement } from "./measureReload";
import type { RequestCount } from "./requestCounts";

/** One terminal row per measured reload. */
export function formatReload(measurement: ReloadMeasurement): string {
  return [
    `${measurement.documents} notes in ${measurement.folders} folders`,
    `${measurement.reload} #${measurement.sample}`,
    `${measurement.requests} requests`,
    `settled in ${measurement.settledMs} ms`,
    `${measurement.database.statements} statements`,
    `${measurement.localSql.calls} local statements`,
  ].join(", ");
}

interface ReloadSummary {
  readonly documents: number;
  readonly folders: number;
  readonly reload: ReloadMeasurement["reload"];
  readonly samples: number;
  readonly medianRequests: number;
  readonly maxRequests: number;
  readonly medianSettledMs: number;
  readonly medianStatements: number;
  readonly medianLocalStatements: number;
  /** Each route's largest count across the samples. */
  readonly maxByRoute: readonly RequestCount[];
}

function maxByRoute(group: readonly ReloadMeasurement[]): RequestCount[] {
  const counts = new Map<string, number>();
  for (const { byRoute } of group)
    for (const { route, count } of byRoute)
      counts.set(route, Math.max(count, counts.get(route) ?? 0));
  return [...counts]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.route < b.route ? -1 : 1,
    );
}

/** Medians per size and kind of reload; maxima per route. */
export function summarizeReloads(
  measurements: readonly ReloadMeasurement[],
): ReloadSummary[] {
  const groups = new Map<string, ReloadMeasurement[]>();
  for (const measurement of measurements) {
    const key = `${measurement.documents}:${measurement.reload}`;
    groups.set(key, [...(groups.get(key) ?? []), measurement]);
  }
  return [...groups.values()].flatMap((group) => {
    const [first] = group;
    if (!first) return [];
    return [
      {
        documents: first.documents,
        folders: first.folders,
        reload: first.reload,
        samples: group.length,
        medianRequests: median(group.map((m) => m.requests)),
        maxRequests: Math.max(...group.map((m) => m.requests)),
        medianSettledMs: median(group.map((m) => m.settledMs)),
        medianStatements: median(group.map((m) => m.database.statements)),
        medianLocalStatements: median(group.map((m) => m.localSql.calls)),
        maxByRoute: maxByRoute(group),
      },
    ];
  });
}
