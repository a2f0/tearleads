import type { EpochSnapshot } from "./schema";

export type MetricDimension =
  | "Schema"
  | "Wire"
  | "API DB"
  | "Client SQLite"
  | "Plans"
  | "Scenarios"
  | "Reload"
  | "Realtime"
  | "Rotations"
  | "Baselines";

export interface MetricDescriptor {
  readonly key: string;
  readonly dimension: MetricDimension;
  readonly label: string;
  readonly unit: string;
  readonly direction: "lower-is-better" | "neutral";
  /** Percentage delta below which noisy wall/duration timings count as unchanged. */
  readonly noiseThresholdPct: number;
  /** Single-snapshot picker for display scorecards. */
  readonly pick: (snapshot: EpochSnapshot) => number | null | undefined;
  /**
   * Optional pair-aware picker that aligns two snapshots on their largest
   * shared scaling tier so mismatched sizes are never compared directly.
   */
  readonly pickPair?: (
    before: EpochSnapshot,
    after: EpochSnapshot,
  ) => readonly [number, number] | undefined;
}

function largestSharedRow<T>(
  beforeRows: readonly T[] | undefined,
  afterRows: readonly T[] | undefined,
  keyOf: (row: T) => string,
  rankOf: (row: T) => number,
): readonly [T, T] | undefined {
  if (!beforeRows || !afterRows) return undefined;
  const afterByKey = new Map(afterRows.map((row) => [keyOf(row), row]));
  let best: readonly [T, T] | undefined;
  let bestRank = -Infinity;
  for (const b of beforeRows) {
    const a = afterByKey.get(keyOf(b));
    if (!a) continue;
    const rank = rankOf(b);
    if (rank > bestRank) {
      bestRank = rank;
      best = [b, a];
    }
  }
  return best;
}

function settledReloadRow(snapshot: EpochSnapshot) {
  const settled = snapshot.reload?.filter((row) => row.reload === "settled");
  return settled && settled.length > 0
    ? [...settled].sort((a, b) => b.documents - a.documents)[0]
    : undefined;
}

function sharedSettledReload(before: EpochSnapshot, after: EpochSnapshot) {
  return largestSharedRow(
    before.reload?.filter((row) => row.reload === "settled"),
    after.reload?.filter((row) => row.reload === "settled"),
    (r) => `${r.documents}:${r.folders}`,
    (r) => r.documents,
  );
}

function largestRealtimeDeclaration(snapshot: EpochSnapshot) {
  const decls = snapshot.realtime?.filter((row) => row.pass === "declaration");
  return decls && decls.length > 0
    ? [...decls].sort((a, b) => b.size - a.size)[0]
    : undefined;
}

function sharedRealtimeDeclaration(
  before: EpochSnapshot,
  after: EpochSnapshot,
) {
  return largestSharedRow(
    before.realtime?.filter((row) => row.pass === "declaration"),
    after.realtime?.filter((row) => row.pass === "declaration"),
    (r) => `${r.size}`,
    (r) => r.size,
  );
}

function largestRotationPhase(snapshot: EpochSnapshot, phase: string) {
  const rows = snapshot.rotations?.filter((row) => row.phase === phase);
  return rows && rows.length > 0
    ? [...rows].sort(
        (a, b) => b.rotations - a.rotations || b.depth - a.depth,
      )[0]
    : undefined;
}

function sharedRotationPhase(
  before: EpochSnapshot,
  after: EpochSnapshot,
  phase: string,
) {
  return largestSharedRow(
    before.rotations?.filter((row) => row.phase === phase),
    after.rotations?.filter((row) => row.phase === phase),
    (r) => `${r.rotations}:${r.depth}`,
    (r) => r.rotations * 1000 + r.depth,
  );
}

function largestBaselinePhase(snapshot: EpochSnapshot, phase: string) {
  const rows = snapshot.baselines?.filter((row) => row.phase === phase);
  return rows && rows.length > 0
    ? [...rows].sort((a, b) => b.sizeMiB - a.sizeMiB)[0]
    : undefined;
}

function sharedBaselinePhase(
  before: EpochSnapshot,
  after: EpochSnapshot,
  phase: string,
) {
  return largestSharedRow(
    before.baselines?.filter((row) => row.phase === phase),
    after.baselines?.filter((row) => row.phase === phase),
    (r) => `${r.sizeMiB}:${r.race}`,
    (r) => r.sizeMiB,
  );
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
    label: "Settled reload requests (shared max tier)",
    unit: "reqs",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => settledReloadRow(s)?.medianRequests,
    pickPair: (b, a) => {
      const pair = sharedSettledReload(b, a);
      return pair
        ? [pair[0].medianRequests, pair[1].medianRequests]
        : undefined;
    },
  },
  {
    key: "reload.settled.apiStatements",
    dimension: "Reload",
    label: "Settled reload API statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => settledReloadRow(s)?.medianApiStatements,
    pickPair: (b, a) => {
      const pair = sharedSettledReload(b, a);
      return pair
        ? [pair[0].medianApiStatements, pair[1].medianApiStatements]
        : undefined;
    },
  },
  {
    key: "reload.settled.clientStatements",
    dimension: "Reload",
    label: "Settled reload client SQLite",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => settledReloadRow(s)?.medianClientStatements,
    pickPair: (b, a) => {
      const pair = sharedSettledReload(b, a);
      return pair
        ? [pair[0].medianClientStatements, pair[1].medianClientStatements]
        : undefined;
    },
  },
  {
    key: "realtime.declaration.statements",
    dimension: "Realtime",
    label: "Realtime hub auth statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => largestRealtimeDeclaration(s)?.statements,
    pickPair: (b, a) => {
      const pair = sharedRealtimeDeclaration(b, a);
      return pair ? [pair[0].statements, pair[1].statements] : undefined;
    },
  },
  {
    key: "realtime.declaration.bytesReturned",
    dimension: "Realtime",
    label: "Realtime hub auth PG bytes",
    unit: "B",
    direction: "lower-is-better",
    noiseThresholdPct: 0.5,
    pick: (s) => largestRealtimeDeclaration(s)?.bytesReturned,
    pickPair: (b, a) => {
      const pair = sharedRealtimeDeclaration(b, a);
      return pair ? [pair[0].bytesReturned, pair[1].bytesReturned] : undefined;
    },
  },
  {
    key: "rotations.groupShrink.pgStatements",
    dimension: "Rotations",
    label: "Rotation group-shrink PG statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) => largestRotationPhase(s, "group-shrink")?.medianPgStatements,
    pickPair: (b, a) => {
      const pair = sharedRotationPhase(b, a, "group-shrink");
      return pair
        ? [pair[0].medianPgStatements, pair[1].medianPgStatements]
        : undefined;
    },
  },
  {
    key: "baselines.firstUnlink.pgStatements",
    dimension: "Baselines",
    label: "Baseline first-unlink PG statements",
    unit: "stmts",
    direction: "lower-is-better",
    noiseThresholdPct: 0,
    pick: (s) =>
      largestBaselinePhase(s, "first-unlink-rotate")?.medianPgStatements,
    pickPair: (b, a) => {
      const pair = sharedBaselinePhase(b, a, "first-unlink-rotate");
      return pair
        ? [pair[0].medianPgStatements, pair[1].medianPgStatements]
        : undefined;
    },
  },
];
