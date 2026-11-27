import { readFile } from "node:fs/promises";
import type { CanaryReport, CanaryRun } from "../canaries/report";
import type { InventoryReport } from "../inventory/markdown";
import { readCaptureFile } from "../statements/captureFile";
import {
  normalizeClientSql,
  parseClientSqlCapture,
} from "../statements/clientSqlSummary";
import {
  parseCapture,
  type RouteStatementSummary,
  type StatementSummary,
  summarizeCapture,
} from "../statements/summary";
import type {
  EpochApiRouteMetrics,
  EpochCanariesMetrics,
  EpochCanaryEntry,
  EpochClientQueryMetrics,
  EpochInventoryMetrics,
} from "./schema";

const txControlPattern =
  /^(?:begin(?:\s+(?:immediate|deferred|exclusive))?|commit|rollback|end(?:\s+transaction)?|savepoint\b|release\b)/iu;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function isTxControlSql(sql: string): boolean {
  return txControlPattern.test(sql.trim());
}

/** Extracts compact schema, OpenAPI, and canary-drift metrics from `perf:inventory`. */
export async function extractInventoryMetrics(
  path: string,
): Promise<EpochInventoryMetrics> {
  const report = await readJsonFile<InventoryReport>(path);
  const headrooms = report.canaries.ceilingDrift.map((item) => item.headroom);
  return {
    postgres: {
      tables: report.postgres.tableCount,
      columns: report.postgres.columnCount,
      indexes: report.postgres.indexCount,
      migrations: report.postgres.migrationCount,
      duplicateIndexes: report.postgres.duplicateIndexes.length,
      unreadTables: report.postgres.unreadTables.length,
      unreadColumns: report.postgres.unreadColumns.length,
    },
    sqlite: {
      totalTables: report.sqlite.totalTableCount,
      sdkTables: report.sqlite.sdkTableCount,
      appProjectionTables: report.sqlite.appProjectionTableCount,
      columns: report.sqlite.columnCount,
      indexes: report.sqlite.indexCount,
      duplicateIndexes: report.sqlite.duplicateIndexes.length,
      unreadTables: report.sqlite.unreadTables.length,
      unreadColumns: report.sqlite.unreadColumns.length,
    },
    openapi: {
      paths: report.openapi.pathCount,
      operations: report.openapi.operationCount,
      distinctResponseFields: report.openapi.distinctResponseFields,
      unreadResponseFieldLeads: report.openapi.unreadResponseFields.length,
      unreadFields: report.openapi.unreadResponseFields.map(
        (entry) => entry.field,
      ),
    },
    canaries: {
      budgetAssertions: report.canaries.budgetAssertionCount,
      driftedPhases: report.canaries.ceilingDrift.length,
      maxHeadroom: headrooms.length > 0 ? Math.max(...headrooms) : 0,
      totalHeadroom: headrooms.reduce((sum, value) => sum + value, 0),
    },
  };
}

interface ParsedRunStatements {
  readonly summary: StatementSummary;
  readonly sameKeyRepeats: number;
  readonly pureReadRepeats: number;
}

function sumRepeatField(
  summary: StatementSummary,
  field: "sameKeyRepeats" | "pureReadRepeats",
): number {
  if (summary.routes.length > 0) {
    return summary.routes.reduce((sum, route) => sum + (route[field] ?? 0), 0);
  }
  return summary.labels.reduce(
    (sum, label) =>
      sum + (label[field]?.reduce((acc, item) => acc + item.count, 0) ?? 0),
    0,
  );
}

async function summarizeRunStatements(
  run: CanaryRun,
): Promise<ParsedRunStatements | null> {
  if (run.statements.status === "off") return null;
  const raw = await readCaptureFile(run.statements.capture).catch(() => null);
  if (raw === null) return null;
  const summary = summarizeCapture(parseCapture(raw), 50);
  return {
    summary,
    sameKeyRepeats: sumRepeatField(summary, "sameKeyRepeats"),
    pureReadRepeats: sumRepeatField(summary, "pureReadRepeats"),
  };
}

async function countTxControls(run: CanaryRun): Promise<number> {
  if (run.clientSql?.status !== "captured") return 0;
  const raw = await readCaptureFile(run.clientSql.capture).catch(() => null);
  if (raw !== null) {
    let count = 0;
    for (const record of parseClientSqlCapture(raw)) {
      if (
        "kind" in record &&
        record.kind === "stmt" &&
        isTxControlSql(record.sql)
      ) {
        count += 1;
      }
    }
    return count;
  }
  return run.clientSql.summary.top
    .filter((entry) => isTxControlSql(entry.sql))
    .reduce((sum, entry) => sum + entry.count, 0);
}

function mergeRouteStats(
  target: Map<string, EpochApiRouteMetrics>,
  routes: readonly RouteStatementSummary[],
): void {
  for (const route of routes) {
    const prev = target.get(route.route);
    target.set(route.route, {
      route: route.route,
      requests: (prev?.requests ?? 0) + route.requests,
      statements: (prev?.statements ?? 0) + route.statements,
      txStatements: (prev?.txStatements ?? 0) + route.txStatements,
      lockHoldStatements:
        (prev?.lockHoldStatements ?? 0) + route.lockHoldStatements,
      pureReadRepeats:
        (prev?.pureReadRepeats ?? 0) + (route.pureReadRepeats ?? 0),
    });
  }
}

function mergeClientTopQueries(
  target: Map<string, { count: number; durationMs: number }>,
  run: CanaryRun,
): void {
  if (run.clientSql?.status !== "captured") return;
  for (const entry of run.clientSql.summary.top) {
    const sql = normalizeClientSql(entry.sql);
    if (isTxControlSql(sql)) continue;
    const prev = target.get(sql) ?? { count: 0, durationMs: 0 };
    target.set(sql, {
      count: prev.count + entry.count,
      durationMs: prev.durationMs + entry.durationMs,
    });
  }
}

function selectFirstPassedSamplePerCanary(
  runs: readonly CanaryRun[],
): CanaryRun[] {
  const byCanary = new Map<string, CanaryRun>();
  for (const run of runs) {
    if (run.status !== "passed") continue;
    if (!byCanary.has(run.canary)) byCanary.set(run.canary, run);
  }
  return [...byCanary.values()].sort((a, b) =>
    a.canary < b.canary ? -1 : a.canary > b.canary ? 1 : 0,
  );
}

interface CanaryTotals {
  wallMs: number;
  requests: number;
  requestBytes: number;
  responseBytes: number;
  echoBytes: number;
  redeliveredBytes: number;
  reDownloadedUploadBytes: number;
  exactHeadRereads: number;
  manifestCitations: number;
  wsHints: number;
  apiStatements: number;
  apiTxStatements: number;
  apiLockHoldStatements: number;
  apiSameKeyRepeats: number;
  apiPureReadRepeats: number;
  clientSqlStatements: number;
  clientSqlInLock: number;
  clientSqlDurationMs: number;
  clientSqlMutations: number;
  clientSqlTxControls: number;
  clientSqlMaxHoldMs: number;
  clientSqlMaxWaitMs: number;
}

function createZeroTotals(): CanaryTotals {
  return {
    wallMs: 0,
    requests: 0,
    requestBytes: 0,
    responseBytes: 0,
    echoBytes: 0,
    redeliveredBytes: 0,
    reDownloadedUploadBytes: 0,
    exactHeadRereads: 0,
    manifestCitations: 0,
    wsHints: 0,
    apiStatements: 0,
    apiTxStatements: 0,
    apiLockHoldStatements: 0,
    apiSameKeyRepeats: 0,
    apiPureReadRepeats: 0,
    clientSqlStatements: 0,
    clientSqlInLock: 0,
    clientSqlDurationMs: 0,
    clientSqlMutations: 0,
    clientSqlTxControls: 0,
    clientSqlMaxHoldMs: 0,
    clientSqlMaxWaitMs: 0,
  };
}

function wireMetricsForRun(run: CanaryRun) {
  const payload =
    run.payloadAudit?.status === "captured" ? run.payloadAudit.summary : null;
  const requests = payload
    ? payload.requests
    : run.phases.reduce((sum, p) => sum + p.total, 0);
  const requestBytes = payload
    ? payload.requestBytes
    : run.phases.reduce((sum, p) => sum + p.bodyBytes.request, 0);
  const responseBytes = payload
    ? payload.responseBytes
    : run.phases.reduce((sum, p) => sum + p.bodyBytes.response, 0);
  const echoBytes = payload?.echoBytes ?? 0;
  const redeliveredBytes = payload?.redeliveredBytes ?? 0;
  const reDownloadedUploadBytes = payload?.reDownloadedUploadBytes ?? 0;
  return {
    requests,
    requestBytes,
    responseBytes,
    echoBytes,
    redeliveredBytes,
    reDownloadedUploadBytes,
    redundantBytes: echoBytes + redeliveredBytes + reDownloadedUploadBytes,
    exactHeadRereads: payload?.exactHeadRereadsCount ?? 0,
    manifestCitations: payload?.manifestCitations ?? 0,
    wsHints: run.phases.reduce((sum, p) => sum + (p.ws?.total ?? 0), 0),
  };
}

async function accumulateCanaryRun(
  run: CanaryRun,
  totals: CanaryTotals,
  routeMap: Map<string, EpochApiRouteMetrics>,
  clientQueryMap: Map<string, { count: number; durationMs: number }>,
): Promise<EpochCanaryEntry> {
  const stmtInfo = await summarizeRunStatements(run);
  const txControls = await countTxControls(run);
  if (stmtInfo) mergeRouteStats(routeMap, stmtInfo.summary.routes);
  mergeClientTopQueries(clientQueryMap, run);

  const wire = wireMetricsForRun(run);
  const client =
    run.clientSql?.status === "captured" ? run.clientSql.summary : null;
  const apiStmts = stmtInfo?.summary.statements ?? 0;
  const apiTx = stmtInfo?.summary.txStatements ?? 0;
  const apiPure = stmtInfo?.pureReadRepeats ?? 0;

  totals.wallMs += run.wallMs;
  totals.requests += wire.requests;
  totals.requestBytes += wire.requestBytes;
  totals.responseBytes += wire.responseBytes;
  totals.echoBytes += wire.echoBytes;
  totals.redeliveredBytes += wire.redeliveredBytes;
  totals.reDownloadedUploadBytes += wire.reDownloadedUploadBytes;
  totals.exactHeadRereads += wire.exactHeadRereads;
  totals.manifestCitations += wire.manifestCitations;
  totals.wsHints += wire.wsHints;
  totals.apiStatements += apiStmts;
  totals.apiTxStatements += apiTx;
  totals.apiLockHoldStatements += stmtInfo?.summary.lockHoldStatements ?? 0;
  totals.apiSameKeyRepeats += stmtInfo?.sameKeyRepeats ?? 0;
  totals.apiPureReadRepeats += apiPure;
  totals.clientSqlStatements += client?.statements ?? 0;
  totals.clientSqlInLock += client?.inLockStatements ?? 0;
  totals.clientSqlDurationMs += client?.durationMs ?? 0;
  totals.clientSqlMutations += client?.mutations ?? 0;
  totals.clientSqlTxControls += txControls;
  totals.clientSqlMaxHoldMs = Math.max(
    totals.clientSqlMaxHoldMs,
    client?.maxMutationHoldMs ?? 0,
  );
  totals.clientSqlMaxWaitMs = Math.max(
    totals.clientSqlMaxWaitMs,
    client?.maxMutationWaitMs ?? 0,
  );

  return {
    canary: run.canary,
    wallMs: Math.round(run.wallMs),
    requests: wire.requests,
    requestBytes: wire.requestBytes,
    responseBytes: wire.responseBytes,
    redundantBytes: wire.redundantBytes,
    exactHeadRereads: wire.exactHeadRereads,
    apiStatements: apiStmts,
    apiTxStatements: apiTx,
    apiPureReadRepeats: apiPure,
    clientSqlStatements: client?.statements ?? 0,
    clientSqlMaxHoldMs: round1(client?.maxMutationHoldMs ?? 0),
  };
}

/** Extracts combined canary wire, API SQL, and client SQLite metrics. */
export async function extractCanariesMetrics(path: string): Promise<{
  readonly metrics: EpochCanariesMetrics;
  readonly revision: string;
  readonly dirty: boolean;
  readonly runtime: CanaryReport["runtime"];
}> {
  const report = await readJsonFile<CanaryReport>(path);
  const runs = selectFirstPassedSamplePerCanary(report.runs);
  const routeMap = new Map<string, EpochApiRouteMetrics>();
  const clientQueryMap = new Map<
    string,
    { count: number; durationMs: number }
  >();
  const totals = createZeroTotals();
  const byCanary: EpochCanaryEntry[] = [];

  for (const run of runs) {
    byCanary.push(
      await accumulateCanaryRun(run, totals, routeMap, clientQueryMap),
    );
  }

  const topApiRoutes = [...routeMap.values()]
    .sort(
      (a, b) => b.statements - a.statements || a.route.localeCompare(b.route),
    )
    .slice(0, 10);
  const topClientQueries: EpochClientQueryMetrics[] = [...clientQueryMap]
    .map(([sql, stat]) => ({
      sql: sql.length > 160 ? `${sql.slice(0, 160)}…` : sql,
      count: stat.count,
      durationMs: round1(stat.durationMs),
    }))
    .sort((a, b) => b.count - a.count || b.durationMs - a.durationMs)
    .slice(0, 10);

  return {
    revision: report.revision,
    dirty: report.dirty,
    runtime: report.runtime,
    metrics: {
      canaryCount: runs.length,
      wallMs: Math.round(totals.wallMs),
      requests: totals.requests,
      requestBytes: totals.requestBytes,
      responseBytes: totals.responseBytes,
      redundantBytes:
        totals.echoBytes +
        totals.redeliveredBytes +
        totals.reDownloadedUploadBytes,
      echoBytes: totals.echoBytes,
      redeliveredBytes: totals.redeliveredBytes,
      reDownloadedUploadBytes: totals.reDownloadedUploadBytes,
      exactHeadRereads: totals.exactHeadRereads,
      manifestCitations: totals.manifestCitations,
      wsHints: totals.wsHints,
      apiStatements: totals.apiStatements,
      apiTxStatements: totals.apiTxStatements,
      apiLockHoldStatements: totals.apiLockHoldStatements,
      apiSameKeyRepeats: totals.apiSameKeyRepeats,
      apiPureReadRepeats: totals.apiPureReadRepeats,
      clientSqlStatements: totals.clientSqlStatements,
      clientSqlInLock: totals.clientSqlInLock,
      clientSqlDurationMs: round1(totals.clientSqlDurationMs),
      clientSqlMutations: totals.clientSqlMutations,
      clientSqlTxControls: totals.clientSqlTxControls,
      clientSqlMaxHoldMs: round1(totals.clientSqlMaxHoldMs),
      clientSqlMaxWaitMs: round1(totals.clientSqlMaxWaitMs),
      topApiRoutes,
      topClientQueries,
      byCanary,
    },
  };
}
