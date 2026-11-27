import type { EpochSnapshot } from "./schema";

export type MetricDimension =
  | "Schema"
  | "Wire"
  | "API DB"
  | "Client SQLite"
  | "Plans"
  | "Scenarios"
  | "Reload"
  | "Realtime";

export type MetricVerdict = "improved" | "regressed" | "unchanged" | "changed";

export interface MetricDescriptor {
  readonly key: string;
  readonly dimension: MetricDimension;
  readonly label: string;
  readonly unit: string;
  readonly direction: "lower-is-better" | "neutral";
  /** Percentage delta below which noisy wall/duration timings count as unchanged. */
  readonly noiseThresholdPct: number;
  readonly pick: (snapshot: EpochSnapshot) => number | undefined;
}

export interface MetricDelta {
  readonly key: string;
  readonly dimension: MetricDimension;
  readonly label: string;
  readonly unit: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly deltaPct: number | null;
  readonly verdict: MetricVerdict;
}

export interface DimensionTradeoff {
  readonly improvedDimension: MetricDimension;
  readonly regressedDimension: MetricDimension;
  readonly improvedSummary: string;
  readonly regressedSummary: string;
}

export interface EpochComparison {
  readonly beforeId: string;
  readonly afterId: string;
  readonly beforeRevision: string;
  readonly afterRevision: string;
  readonly metrics: readonly MetricDelta[];
  readonly improvements: readonly MetricDelta[];
  readonly regressions: readonly MetricDelta[];
  readonly tradeoffs: readonly DimensionTradeoff[];
}

function settledReloadRow(snapshot: EpochSnapshot) {
  const settled = snapshot.reload?.filter((row) => row.reload === "settled");
  if (!settled || settled.length === 0) return undefined;
  return [...settled].sort((a, b) => b.documents - a.documents)[0];
}

function largestRealtimeDeclaration(snapshot: EpochSnapshot) {
  const decls = snapshot.realtime?.filter((row) => row.pass === "declaration");
  if (!decls || decls.length === 0) return undefined;
  return [...decls].sort((a, b) => b.size - a.size)[0];
}

/** Canonical cross-dimension scorecard tracked across every Epoch 2 snapshot. */
export const epochMetricDescriptors: readonly MetricDescriptor[] = [
  {
    key: "inventory.postgres.tables",
    dimension: "Schema",
    label: "API Postgres tables",
    unit: "tables",
    direction: "neutral",
    noiseThresholdPct: 0,
    pick: (s) => s.inventory?.postgres.tables,
  },
  {
    key: "inventory.postgres.indexes",
    dimension: "Schema",
    label: "API Postgres indexes",
    unit: "indexes",
    direction: "neutral",
    noiseThresholdPct: 0,
    pick: (s) => s.inventory?.postgres.indexes,
  },
  {
    key: "inventory.postgres.duplicateIndexes",
    dimension: "Schema",
    label: "API duplicate indexes",
    unit: "indexes",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.inventory?.postgres.duplicateIndexes,
  },
  {
    key: "inventory.sqlite.totalTables",
    dimension: "Schema",
    label: "Client SQLite tables",
    unit: "tables",
    direction: "neutral",
    noiseThresholdPct: 0,
    pick: (s) => s.inventory?.sqlite.totalTables,
  },
  {
    key: "inventory.openapi.unreadLeads",
    dimension: "Schema",
    label: "Unread 2xx OpenAPI fields",
    unit: "fields",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.inventory?.openapi.unreadResponseFieldLeads,
  },
  {
    key: "inventory.canaries.driftedPhases",
    dimension: "Schema",
    label: "Drifted canary ceilings",
    unit: "phases",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.inventory?.canaries.driftedPhases,
  },
  {
    key: "canaries.requests",
    dimension: "Wire",
    label: "Canary requests",
    unit: "reqs",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.requests,
  },
  {
    key: "canaries.requestBytes",
    dimension: "Wire",
    label: "Canary request bytes",
    unit: "B",
    direction: "lower-is-better",
    noiseThresholdPct: 0.5,
    pick: (s) => s.canaries?.requestBytes,
  },
  {
    key: "canaries.responseBytes",
    dimension: "Wire",
    label: "Canary response bytes",
    unit: "B",
    direction: "lower-is-better",
    noiseThresholdPct: 0.5,
    pick: (s) => s.canaries?.responseBytes,
  },
  {
    key: "canaries.redundantBytes",
    dimension: "Wire",
    label: "Canary redundant response bytes",
    unit: "B",
    direction: "lower-is-better",
    noiseThresholdPct: 0.5,
    pick: (s) => s.canaries?.redundantBytes,
  },
  {
    key: "canaries.exactHeadRereads",
    dimension: "Wire",
    label: "Exact-head policy re-reads",
    unit: "reads",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.exactHeadRereads,
  },
  {
    key: "canaries.apiStatements",
    dimension: "API DB",
    label: "Canary API SQL statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.apiStatements,
  },
  {
    key: "canaries.apiTxStatements",
    dimension: "API DB",
    label: "Canary API in-tx statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.apiTxStatements,
  },
  {
    key: "canaries.apiLockHoldStatements",
    dimension: "API DB",
    label: "Canary API lock-hold statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.apiLockHoldStatements,
  },
  {
    key: "canaries.apiPureReadRepeats",
    dimension: "API DB",
    label: "Canary API pure read repeats",
    unit: "repeats",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.apiPureReadRepeats,
  },
  {
    key: "canaries.clientSqlStatements",
    dimension: "Client SQLite",
    label: "Canary client SQLite statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.clientSqlStatements,
  },
  {
    key: "canaries.clientSqlTxControls",
    dimension: "Client SQLite",
    label: "Canary SQLite tx controls",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.canaries?.clientSqlTxControls,
  },
  {
    key: "canaries.clientSqlDurationMs",
    dimension: "Client SQLite",
    label: "Canary SQLite total duration",
    unit: "ms",
    direction: "lower-is-better",
    noiseThresholdPct: 5,
    pick: (s) => s.canaries?.clientSqlDurationMs,
  },
  {
    key: "canaries.clientSqlMaxHoldMs",
    dimension: "Client SQLite",
    label: "Canary SQLite max lock hold",
    unit: "ms",
    direction: "lower-is-better",
    noiseThresholdPct: 10,
    pick: (s) => s.canaries?.clientSqlMaxHoldMs,
  },
  {
    key: "plans.seqScanQueries",
    dimension: "Plans",
    label: "Postgres generic Seq Scans",
    unit: "queries",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.plans?.seqScanQueries,
  },
  {
    key: "plans.sortQueries",
    dimension: "Plans",
    label: "Postgres generic Sort plans",
    unit: "queries",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.plans?.sortQueries,
  },
  {
    key: "plans.materializeQueries",
    dimension: "Plans",
    label: "Postgres generic Materialize plans",
    unit: "queries",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.plans?.materializeQueries,
  },
  {
    key: "scenarios.requests",
    dimension: "Scenarios",
    label: "Bob-and-Alice HTTP requests",
    unit: "reqs",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.scenarios?.requests,
  },
  {
    key: "scenarios.apiStatements",
    dimension: "Scenarios",
    label: "Bob-and-Alice API statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.scenarios?.apiStatements,
  },
  {
    key: "scenarios.pureReadRepeats",
    dimension: "Scenarios",
    label: "Bob-and-Alice pure read repeats",
    unit: "repeats",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.scenarios?.pureReadRepeats,
  },
  {
    key: "scenarios.clientSqlStatements",
    dimension: "Scenarios",
    label: "Bob-and-Alice client SQLite",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => s.scenarios?.clientSqlStatements,
  },
  {
    key: "reload.settled.requests",
    dimension: "Reload",
    label: "Settled reload requests (max tier)",
    unit: "reqs",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => settledReloadRow(s)?.medianRequests,
  },
  {
    key: "reload.settled.apiStatements",
    dimension: "Reload",
    label: "Settled reload API statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => settledReloadRow(s)?.medianApiStatements,
  },
  {
    key: "reload.settled.clientStatements",
    dimension: "Reload",
    label: "Settled reload client SQLite",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => settledReloadRow(s)?.medianClientStatements,
  },
  {
    key: "realtime.declaration.statements",
    dimension: "Realtime",
    label: "Realtime hub auth statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => largestRealtimeDeclaration(s)?.statements,
  },
  {
    key: "realtime.declaration.bytesReturned",
    dimension: "Realtime",
    label: "Realtime hub auth PG bytes",
    unit: "B",
    direction: "lower-is-better",
    noiseThresholdPct: 0.5,
    pick: (s) => largestRealtimeDeclaration(s)?.bytesReturned,
  },
];

function classifyMetric(
  descriptor: MetricDescriptor,
  before: number,
  after: number,
): MetricDelta {
  const delta = Math.round((after - before) * 10) / 10;
  const deltaPct =
    before === 0
      ? after === 0
        ? 0
        : null
      : Math.round(((after - before) / before) * 1000) / 10;
  if (delta === 0) {
    return {
      key: descriptor.key,
      dimension: descriptor.dimension,
      label: descriptor.label,
      unit: descriptor.unit,
      before,
      after,
      delta: 0,
      deltaPct: 0,
      verdict: "unchanged",
    };
  }
  const absPct = deltaPct === null ? Infinity : Math.abs(deltaPct);
  if (
    descriptor.noiseThresholdPct > 0 &&
    absPct < descriptor.noiseThresholdPct
  ) {
    return {
      key: descriptor.key,
      dimension: descriptor.dimension,
      label: descriptor.label,
      unit: descriptor.unit,
      before,
      after,
      delta,
      deltaPct,
      verdict: "unchanged",
    };
  }
  const verdict: MetricVerdict =
    descriptor.direction === "neutral"
      ? "changed"
      : delta < 0
        ? "improved"
        : "regressed";
  return {
    key: descriptor.key,
    dimension: descriptor.dimension,
    label: descriptor.label,
    unit: descriptor.unit,
    before,
    after,
    delta,
    deltaPct,
    verdict,
  };
}

function summarizeDimensionMoves(deltas: readonly MetricDelta[]): string {
  return deltas
    .slice(0, 3)
    .map((item) => {
      const sign = item.delta > 0 ? "+" : "";
      const pct = item.deltaPct === null ? "" : ` (${sign}${item.deltaPct}%)`;
      return `${item.label}: ${sign}${item.delta} ${item.unit}${pct}`;
    })
    .join("; ");
}

function detectTradeoffs(
  improvements: readonly MetricDelta[],
  regressions: readonly MetricDelta[],
): DimensionTradeoff[] {
  if (improvements.length === 0 || regressions.length === 0) return [];
  const impByDim = new Map<MetricDimension, MetricDelta[]>();
  const regByDim = new Map<MetricDimension, MetricDelta[]>();
  for (const item of improvements) {
    impByDim.set(item.dimension, [
      ...(impByDim.get(item.dimension) ?? []),
      item,
    ]);
  }
  for (const item of regressions) {
    regByDim.set(item.dimension, [
      ...(regByDim.get(item.dimension) ?? []),
      item,
    ]);
  }
  const tradeoffs: DimensionTradeoff[] = [];
  for (const [impDim, impList] of impByDim) {
    for (const [regDim, regList] of regByDim) {
      tradeoffs.push({
        improvedDimension: impDim,
        regressedDimension: regDim,
        improvedSummary: summarizeDimensionMoves(impList),
        regressedSummary: summarizeDimensionMoves(regList),
      });
    }
  }
  return tradeoffs;
}

/** Compares two Epoch 2 snapshots across all shared metrics, surfacing tradeoffs. */
export function compareSnapshots(
  before: EpochSnapshot,
  after: EpochSnapshot,
): EpochComparison {
  const metrics: MetricDelta[] = [];
  for (const descriptor of epochMetricDescriptors) {
    const beforeVal = descriptor.pick(before);
    const afterVal = descriptor.pick(after);
    if (beforeVal === undefined || afterVal === undefined) continue;
    metrics.push(classifyMetric(descriptor, beforeVal, afterVal));
  }
  const improvements = metrics.filter((item) => item.verdict === "improved");
  const regressions = metrics.filter((item) => item.verdict === "regressed");
  return {
    beforeId: before.id,
    afterId: after.id,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    metrics,
    improvements,
    regressions,
    tradeoffs: detectTradeoffs(improvements, regressions),
  };
}
