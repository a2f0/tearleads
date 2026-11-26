import type { ApiRequestMetricsSnapshot } from "@tearleads/client-sdk";

export interface RequestCount {
  /** Method and route template, such as `POST /documents/{documentId}/sync`. */
  readonly route: string;
  readonly count: number;
}

/** Largest count first, then by route. */
export function byCountThenRoute(a: RequestCount, b: RequestCount): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.route < b.route ? -1 : 1;
}

/** Request counts per route template, largest first, then by route. */
export function requestCounts(
  endpoints: ApiRequestMetricsSnapshot["endpoints"],
): RequestCount[] {
  const counts = new Map<string, number>();
  for (const endpoint of endpoints) {
    const route = `${endpoint.method} ${endpoint.path}`;
    counts.set(route, (counts.get(route) ?? 0) + endpoint.total);
  }
  return [...counts]
    .map(([route, count]) => ({ route, count }))
    .sort(byCountThenRoute);
}
