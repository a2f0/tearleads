import { readFile } from "node:fs/promises";
import {
  type CanaryReport,
  type CanaryRun,
  loadCanaryReport,
} from "../canaries/report";
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
import {
  isObject,
  requireArray,
  requireFiniteNumber,
  requireObject,
  requireString,
} from "./validate";

const txControlPattern =
  /^(?:begin(?:\s+(?:immediate|deferred|exclusive))?|commit|rollback|end(?:\s+transaction)?|savepoint\b|release\b)/iu;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isTxControlSql(sql: string): boolean {
  return txControlPattern.test(sql.trim());
}

/** Extracts compact schema, OpenAPI, and canary-drift metrics from `perf:inventory`. */
export async function extractInventoryMetrics(
  path: string,
): Promise<EpochInventoryMetrics> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !isObject(parsed) ||
    Reflect.get(parsed, "scenario") !== "static-inventory"
  ) {
    throw new Error(`${path} is not a valid perf:inventory report.`);
  }
  const pg = requireObject(Reflect.get(parsed, "postgres"), `${path} postgres`);
  const sq = requireObject(Reflect.get(parsed, "sqlite"), `${path} sqlite`);
  const oa = requireObject(Reflect.get(parsed, "openapi"), `${path} openapi`);
  const ca = requireObject(Reflect.get(parsed, "canaries"), `${path} canaries`);
  const unreadFields = requireArray(oa, "unreadResponseFields", path).map(
    (entry, idx) =>
      requireString(
        requireObject(entry, `${path} unreadResponseFields[${idx}]`),
        "field",
        path,
      ),
  );
  const headrooms = requireArray(ca, "ceilingDrift", path).map((entry, idx) =>
    requireFiniteNumber(
      requireObject(entry, `${path} ceilingDrift[${idx}]`),
      "headroom",
      path,
    ),
  );
  return {
    postgres: {
      tables: requireFiniteNumber(pg, "tableCount", path),
      columns: requireFiniteNumber(pg, "columnCount", path),
      indexes: requireFiniteNumber(pg, "indexCount", path),
      migrations: requireFiniteNumber(pg, "migrationCount", path),
      duplicateIndexes: requireArray(pg, "duplicateIndexes", path).length,
      unreadTables: requireArray(pg, "unreadTables", path).length,
      unreadColumns: requireArray(pg, "unreadColumns", path).length,
    },
    sqlite: {
      totalTables: requireFiniteNumber(sq, "totalTableCount", path),
      sdkTables: requireFiniteNumber(sq, "sdkTableCount", path),
      appProjectionTables: requireFiniteNumber(
        sq,
        "appProjectionTableCount",
        path,
      ),
      columns: requireFiniteNumber(sq, "columnCount", path),
      indexes: requireFiniteNumber(sq, "indexCount", path),
      duplicateIndexes: requireArray(sq, "duplicateIndexes", path).length,
      unreadTables: requireArray(sq, "unreadTables", path).length,
      unreadColumns: requireArray(sq, "unreadColumns", path).length,
    },
    openapi: {
      paths: requireFiniteNumber(oa, "pathCount", path),
      operations: requireFiniteNumber(oa, "operationCount", path),
      distinctResponseFields: requireFiniteNumber(
        oa,
        "distinctResponseFields",
        path,
      ),
      unreadResponseFieldLeads: unreadFields.length,
      unreadFields,
    },
    canaries: {
      budgetAssertions: requireFiniteNumber(ca, "budgetAssertionCount", path),
      driftedPhases: headrooms.length,
      maxHeadroom: headrooms.length > 0 ? Math.max(...headrooms) : 0,
      totalHeadroom: headrooms.reduce((sum, value) => sum + value, 0),
    },
  };
}

interface ParsedRunStatements {
  readonly summary: StatementSummary;
  readonly sameKeyRepeats: number | null;
  readonly pureReadRepeats: number | null;
}

function sumRepeatField(
  summary: StatementSummary,
  field: "sameKeyRepeats" | "pureReadRepeats",
): number | null {
  if (!summary.paramHashes) return null;
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
  if (run.statements.status !== "captured") return null;
  const raw = await readCaptureFile(run.statements.capture).catch(() => null);
  if (raw === null) return null;
  const summary = summarizeCapture(parseCapture(raw), 50);
  if (summary.truncated) return null;
  return {
    summary,
    sameKeyRepeats: sumRepeatField(summary, "sameKeyRepeats"),
    pureReadRepeats: sumRepeatField(summary, "pureReadRepeats"),
  };
}

async function countTxControls(run: CanaryRun): Promise<number | null> {
  if (run.clientSql?.status !== "captured") return null;
  if (run.clientSql.summary.truncated) return null;
  const raw = await readCaptureFile(run.clientSql.capture).catch(() => null);
  if (raw === null) return null;
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

function mergeRouteStats(
  target: Map<string, EpochApiRouteMetrics>,
  routes: readonly RouteStatementSummary[],
): void {
  for (const route of routes) {
    const prev = target.get(route.route);
    const pureRepeats =
      prev === undefined
        ? route.pureReadRepeats
        : prev.pureReadRepeats === null || route.pureReadRepeats === null
          ? null
          : prev.pureReadRepeats + route.pureReadRepeats;
    target.set(route.route, {
      route: route.route,
      requests: (prev?.requests ?? 0) + route.requests,
      statements: (prev?.statements ?? 0) + route.statements,
      txStatements: (prev?.txStatements ?? 0) + route.txStatements,
      lockHoldStatements:
        (prev?.lockHoldStatements ?? 0) + route.lockHoldStatements,
      pureReadRepeats: pureRepeats,
    });
  }
}

function mergeClientTopQueries(
  target: Map<string, { count: number; durationMs: number }>,
  run: CanaryRun,
): void {
  if (run.clientSql?.status !== "captured" || run.clientSql.summary.truncated) {
    return;
  }
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

interface RunExtraction {
  readonly entry: EpochCanaryEntry;
  readonly wsHints: number;
  readonly echoBytes: number | null;
  readonly redeliveredBytes: number | null;
  readonly reDownloadedUploadBytes: number | null;
  readonly manifestCitations: number | null;
  readonly apiLockHoldStatements: number | null;
  readonly apiSameKeyRepeats: number | null;
  readonly clientSqlInLock: number | null;
  readonly clientSqlDurationMs: number | null;
  readonly clientSqlMutations: number | null;
  readonly clientSqlTxControls: number | null;
  readonly clientSqlMaxWaitMs: number | null;
}

function sumAllOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) {
    return null;
  }
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function maxAllOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) {
    return null;
  }
  return Math.max(...values.map((value) => value ?? 0));
}

function isZeroRequestRun(run: CanaryRun): boolean {
  return (
    run.phases.length > 0 && run.phases.every((phase) => phase.total === 0)
  );
}

function extractPayloadFields(run: CanaryRun, payloadAuditEnabled: boolean) {
  const payload =
    run.payloadAudit?.status === "captured" ? run.payloadAudit.summary : null;
  if (!payload) {
    if (
      payloadAuditEnabled &&
      run.payloadAudit?.status === "missing" &&
      isZeroRequestRun(run)
    ) {
      return {
        requests: 0,
        requestBytes: 0,
        responseBytes: 0,
        redundantBytes: 0,
        echoBytes: 0,
        redeliveredBytes: 0,
        reDownloadedUploadBytes: 0,
        exactHeadRereads: 0,
        manifestCitations: 0,
      };
    }
    return {
      requests: null,
      requestBytes: null,
      responseBytes: null,
      redundantBytes: null,
      echoBytes: null,
      redeliveredBytes: null,
      reDownloadedUploadBytes: null,
      exactHeadRereads: null,
      manifestCitations: null,
    };
  }
  return {
    requests: payload.requests,
    requestBytes: payload.requestBytes,
    responseBytes: payload.responseBytes,
    redundantBytes:
      payload.echoBytes +
      payload.redeliveredBytes +
      payload.reDownloadedUploadBytes,
    echoBytes: payload.echoBytes,
    redeliveredBytes: payload.redeliveredBytes,
    reDownloadedUploadBytes: payload.reDownloadedUploadBytes,
    exactHeadRereads: payload.exactHeadRereadsCount,
    manifestCitations: payload.manifestCitations,
  };
}

function extractClientFields(run: CanaryRun, txControls: number | null) {
  const client =
    run.clientSql?.status === "captured" && !run.clientSql.summary.truncated
      ? run.clientSql.summary
      : null;
  return {
    statements: client?.statements ?? null,
    inLock: client?.inLockStatements ?? null,
    durationMs: client?.durationMs ?? null,
    mutations: client?.mutations ?? null,
    txControls,
    maxHoldMs: client ? round1(client.maxMutationHoldMs) : null,
    maxWaitMs: client ? round1(client.maxMutationWaitMs) : null,
  };
}

async function extractOneRun(
  run: CanaryRun,
  payloadAuditEnabled: boolean,
  routeMap: Map<string, EpochApiRouteMetrics>,
  clientQueryMap: Map<string, { count: number; durationMs: number }>,
): Promise<RunExtraction> {
  const stmtInfo = await summarizeRunStatements(run);
  const txControls = await countTxControls(run);
  if (stmtInfo) mergeRouteStats(routeMap, stmtInfo.summary.routes);
  mergeClientTopQueries(clientQueryMap, run);

  const wire = extractPayloadFields(run, payloadAuditEnabled);
  const client = extractClientFields(run, txControls);

  return {
    entry: {
      canary: run.canary,
      wallMs: Math.round(run.wallMs),
      requests: wire.requests,
      requestBytes: wire.requestBytes,
      responseBytes: wire.responseBytes,
      redundantBytes: wire.redundantBytes,
      exactHeadRereads: wire.exactHeadRereads,
      apiStatements: stmtInfo?.summary.statements ?? null,
      apiTxStatements: stmtInfo?.summary.txStatements ?? null,
      apiPureReadRepeats: stmtInfo?.pureReadRepeats ?? null,
      clientSqlStatements: client.statements,
      clientSqlMaxHoldMs: client.maxHoldMs,
    },
    wsHints: run.phases.reduce((sum, p) => sum + (p.ws?.total ?? 0), 0),
    echoBytes: wire.echoBytes,
    redeliveredBytes: wire.redeliveredBytes,
    reDownloadedUploadBytes: wire.reDownloadedUploadBytes,
    manifestCitations: wire.manifestCitations,
    apiLockHoldStatements: stmtInfo?.summary.lockHoldStatements ?? null,
    apiSameKeyRepeats: stmtInfo?.sameKeyRepeats ?? null,
    clientSqlInLock: client.inLock,
    clientSqlDurationMs: client.durationMs,
    clientSqlMutations: client.mutations,
    clientSqlTxControls: client.txControls,
    clientSqlMaxWaitMs: client.maxWaitMs,
  };
}

function aggregateExtractedRuns(
  extracted: readonly RunExtraction[],
  topApiRoutes: readonly EpochApiRouteMetrics[],
  topClientQueries: readonly EpochClientQueryMetrics[],
): EpochCanariesMetrics {
  const rawDuration = sumAllOrNull(extracted.map((r) => r.clientSqlDurationMs));
  const rawMaxHold = maxAllOrNull(
    extracted.map((r) => r.entry.clientSqlMaxHoldMs),
  );
  const rawMaxWait = maxAllOrNull(extracted.map((r) => r.clientSqlMaxWaitMs));
  return {
    canaryCount: extracted.length,
    wallMs: extracted.reduce((sum, r) => sum + r.entry.wallMs, 0),
    requests: sumAllOrNull(extracted.map((r) => r.entry.requests)),
    requestBytes: sumAllOrNull(extracted.map((r) => r.entry.requestBytes)),
    responseBytes: sumAllOrNull(extracted.map((r) => r.entry.responseBytes)),
    redundantBytes: sumAllOrNull(extracted.map((r) => r.entry.redundantBytes)),
    echoBytes: sumAllOrNull(extracted.map((r) => r.echoBytes)),
    redeliveredBytes: sumAllOrNull(extracted.map((r) => r.redeliveredBytes)),
    reDownloadedUploadBytes: sumAllOrNull(
      extracted.map((r) => r.reDownloadedUploadBytes),
    ),
    exactHeadRereads: sumAllOrNull(
      extracted.map((r) => r.entry.exactHeadRereads),
    ),
    manifestCitations: sumAllOrNull(extracted.map((r) => r.manifestCitations)),
    wsHints: extracted.reduce((sum, r) => sum + r.wsHints, 0),
    apiStatements: sumAllOrNull(extracted.map((r) => r.entry.apiStatements)),
    apiTxStatements: sumAllOrNull(
      extracted.map((r) => r.entry.apiTxStatements),
    ),
    apiLockHoldStatements: sumAllOrNull(
      extracted.map((r) => r.apiLockHoldStatements),
    ),
    apiSameKeyRepeats: sumAllOrNull(extracted.map((r) => r.apiSameKeyRepeats)),
    apiPureReadRepeats: sumAllOrNull(
      extracted.map((r) => r.entry.apiPureReadRepeats),
    ),
    clientSqlStatements: sumAllOrNull(
      extracted.map((r) => r.entry.clientSqlStatements),
    ),
    clientSqlInLock: sumAllOrNull(extracted.map((r) => r.clientSqlInLock)),
    clientSqlDurationMs: rawDuration === null ? null : round1(rawDuration),
    clientSqlMutations: sumAllOrNull(
      extracted.map((r) => r.clientSqlMutations),
    ),
    clientSqlTxControls: sumAllOrNull(
      extracted.map((r) => r.clientSqlTxControls),
    ),
    clientSqlMaxHoldMs: rawMaxHold === null ? null : round1(rawMaxHold),
    clientSqlMaxWaitMs: rawMaxWait === null ? null : round1(rawMaxWait),
    topApiRoutes,
    topClientQueries,
    byCanary: extracted.map((r) => r.entry),
  };
}

/** Extracts combined canary wire, API SQL, and client SQLite metrics. */
export async function extractCanariesMetrics(path: string): Promise<{
  readonly metrics: EpochCanariesMetrics;
  readonly revision: string;
  readonly dirty: boolean;
  readonly runtime: CanaryReport["runtime"];
}> {
  const report = await loadCanaryReport(path);
  const runs = selectFirstPassedSamplePerCanary(report.runs);
  const routeMap = new Map<string, EpochApiRouteMetrics>();
  const clientQueryMap = new Map<
    string,
    { count: number; durationMs: number }
  >();
  const payloadAuditEnabled = report.options.payloadAudit === true;
  const extracted: RunExtraction[] = [];
  for (const run of runs) {
    extracted.push(
      await extractOneRun(run, payloadAuditEnabled, routeMap, clientQueryMap),
    );
  }

  const topApiRoutes = [...routeMap.values()]
    .sort(
      (a, b) =>
        b.statements - a.statements ||
        (a.route < b.route ? -1 : a.route > b.route ? 1 : 0),
    )
    .slice(0, 10);
  const topClientQueries: EpochClientQueryMetrics[] = [...clientQueryMap]
    .map(([sql, stat]) => ({
      sql: sql.length > 160 ? `${sql.slice(0, 160)}…` : sql,
      count: stat.count,
      durationMs: round1(stat.durationMs),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.durationMs - a.durationMs ||
        (a.sql < b.sql ? -1 : a.sql > b.sql ? 1 : 0),
    )
    .slice(0, 10);

  return {
    revision: report.revision,
    dirty: report.dirty,
    runtime: report.runtime,
    metrics: aggregateExtractedRuns(extracted, topApiRoutes, topClientQueries),
  };
}
