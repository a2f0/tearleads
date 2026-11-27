/**
 * JSONL capture types, parser, and summarizer for HTTP exchanges and harness
 * operations observed during `packages/bob-and-alice` scenario runs.
 */

export type ScenarioHttpRecord =
  | {
      readonly kind: "http";
      readonly route: string;
      readonly method: string;
      readonly status: number;
      readonly errorCode?: string;
      readonly requestBytes: number;
      readonly responseBytes: number;
      readonly durationMs: number;
      readonly knownManifestsCount: number;
    }
  | {
      readonly kind: "op";
      readonly name: string;
    }
  | {
      readonly truncated: number;
    };

export interface ScenarioRouteMetrics {
  readonly count: number;
  readonly conflicts: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly serverMs: number;
}

export interface ScenarioHttpSummary {
  readonly requests: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly serverMs: number;
  readonly conflicts: number;
  readonly clientErrors: number;
  readonly manifestCitations: number;
  readonly truncated: boolean;
  readonly statuses: Readonly<Record<string, number>>;
  readonly errorCodes: Readonly<Record<string, number>>;
  readonly operations: Readonly<Record<string, number>>;
  readonly byRoute: Readonly<Record<string, ScenarioRouteMetrics>>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHttpRecord(
  value: object,
): value is Extract<ScenarioHttpRecord, { kind: "http" }> {
  const errorCode: unknown = Reflect.get(value, "errorCode");
  return (
    Reflect.get(value, "kind") === "http" &&
    typeof Reflect.get(value, "route") === "string" &&
    typeof Reflect.get(value, "method") === "string" &&
    isFiniteNumber(Reflect.get(value, "status")) &&
    (errorCode === undefined || typeof errorCode === "string") &&
    isFiniteNumber(Reflect.get(value, "requestBytes")) &&
    isFiniteNumber(Reflect.get(value, "responseBytes")) &&
    isFiniteNumber(Reflect.get(value, "durationMs")) &&
    isFiniteNumber(Reflect.get(value, "knownManifestsCount"))
  );
}

function isOpRecord(
  value: object,
): value is Extract<ScenarioHttpRecord, { kind: "op" }> {
  return (
    Reflect.get(value, "kind") === "op" &&
    typeof Reflect.get(value, "name") === "string"
  );
}

function isScenarioHttpRecord(value: unknown): value is ScenarioHttpRecord {
  if (typeof value !== "object" || value === null) return false;
  return (
    isHttpRecord(value) ||
    isOpRecord(value) ||
    typeof Reflect.get(value, "truncated") === "number"
  );
}

export function parseScenarioHttpCapture(text: string): ScenarioHttpRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const parsed: unknown = JSON.parse(line);
      if (!isScenarioHttpRecord(parsed)) {
        throw new Error(`Scenario HTTP capture line ${index + 1} is invalid.`);
      }
      return parsed;
    });
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function sortedCounts(
  map: ReadonlyMap<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort(
      ([aKey, aCount], [bKey, bCount]) =>
        bCount - aCount || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0),
    ),
  );
}

interface MutableRouteStats {
  count: number;
  conflicts: number;
  requestBytes: number;
  responseBytes: number;
  serverMs: number;
}

interface MutableHttpTotals {
  requests: number;
  requestBytes: number;
  responseBytes: number;
  serverMs: number;
  conflicts: number;
  clientErrors: number;
  manifestCitations: number;
  truncated: boolean;
  readonly statuses: Map<string, number>;
  readonly errorCodes: Map<string, number>;
  readonly operations: Map<string, number>;
  readonly routes: Map<string, MutableRouteStats>;
}

function addCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function accumulateHttpRecord(
  totals: MutableHttpTotals,
  record: Extract<ScenarioHttpRecord, { kind: "http" }>,
): void {
  totals.requests += 1;
  totals.requestBytes += record.requestBytes;
  totals.responseBytes += record.responseBytes;
  totals.serverMs += record.durationMs;
  totals.manifestCitations += record.knownManifestsCount;
  if (record.status === 409) totals.conflicts += 1;
  if (record.status >= 400 && record.status < 500) totals.clientErrors += 1;
  addCount(totals.statuses, String(record.status));
  if (record.errorCode) addCount(totals.errorCodes, record.errorCode);
  const entry = totals.routes.get(record.route) ?? {
    count: 0,
    conflicts: 0,
    requestBytes: 0,
    responseBytes: 0,
    serverMs: 0,
  };
  entry.count += 1;
  if (record.status === 409) entry.conflicts += 1;
  entry.requestBytes += record.requestBytes;
  entry.responseBytes += record.responseBytes;
  entry.serverMs += record.durationMs;
  totals.routes.set(record.route, entry);
}

function formatRouteStats(
  routes: ReadonlyMap<string, MutableRouteStats>,
): Record<string, ScenarioRouteMetrics> {
  return Object.fromEntries(
    [...routes.entries()]
      .sort(
        ([aRoute, a], [bRoute, b]) =>
          b.count - a.count ||
          b.responseBytes +
            b.requestBytes -
            (a.responseBytes + a.requestBytes) ||
          (aRoute < bRoute ? -1 : aRoute > bRoute ? 1 : 0),
      )
      .map(([route, stats]) => [
        route,
        {
          count: stats.count,
          conflicts: stats.conflicts,
          requestBytes: stats.requestBytes,
          responseBytes: stats.responseBytes,
          serverMs: roundMs(stats.serverMs),
        },
      ]),
  );
}

export function summarizeScenarioHttp(
  records: readonly ScenarioHttpRecord[],
): ScenarioHttpSummary {
  const totals: MutableHttpTotals = {
    requests: 0,
    requestBytes: 0,
    responseBytes: 0,
    serverMs: 0,
    conflicts: 0,
    clientErrors: 0,
    manifestCitations: 0,
    truncated: false,
    statuses: new Map(),
    errorCodes: new Map(),
    operations: new Map(),
    routes: new Map(),
  };

  for (const record of records) {
    if ("truncated" in record) totals.truncated = true;
    else if (record.kind === "op") addCount(totals.operations, record.name);
    else accumulateHttpRecord(totals, record);
  }

  return {
    requests: totals.requests,
    requestBytes: totals.requestBytes,
    responseBytes: totals.responseBytes,
    serverMs: roundMs(totals.serverMs),
    conflicts: totals.conflicts,
    clientErrors: totals.clientErrors,
    manifestCitations: totals.manifestCitations,
    truncated: totals.truncated,
    statuses: sortedCounts(totals.statuses),
    errorCodes: sortedCounts(totals.errorCodes),
    operations: sortedCounts(totals.operations),
    byRoute: formatRouteStats(totals.routes),
  };
}
