import { readFile } from "node:fs/promises";
import type { BaselineSummaryRow } from "../baselines/summary";
import type { PlanReportSummary } from "../plans/planAnalysis";
import type { RotationSummaryRow } from "../rotations/summary";
import { loadScenarioReport } from "../scenarios/report";
import type {
  EpochBaselineRow,
  EpochPlansMetrics,
  EpochRealtimeRow,
  EpochReloadRow,
  EpochRotationRow,
  EpochScenariosMetrics,
} from "./schema";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sumAllOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) {
    return null;
  }
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

async function readCompleteProbeSummary<T>(
  path: string,
  expectedScenario: string,
): Promise<readonly T[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !isObject(parsed) ||
    Reflect.get(parsed, "scenario") !== expectedScenario
  ) {
    throw new Error(`${path} is not a ${expectedScenario} report.`);
  }
  const status = Reflect.get(parsed, "status");
  if (status !== "complete") {
    throw new Error(
      `${path} has status '${String(status)}'; record only complete reports.`,
    );
  }
  const summary = Reflect.get(parsed, "summary");
  if (!Array.isArray(summary)) {
    throw new Error(`${path} is missing a summary array.`);
  }
  return summary as readonly T[];
}

/** Extracts multi-party bob-and-alice scenario totals from `perf:scenarios`. */
export async function extractScenariosMetrics(
  path: string,
): Promise<EpochScenariosMetrics> {
  const report = await loadScenarioReport(path);
  const byScenario = [...report.summary]
    .sort((a, b) =>
      a.scenario < b.scenario ? -1 : a.scenario > b.scenario ? 1 : 0,
    )
    .map((item) => ({
      scenario: item.scenario,
      wallMs: Math.round(item.wallMs.min),
      requests: item.requests.min,
      conflicts: item.conflicts.max,
      requestBytes: item.requestBytes.min,
      responseBytes: item.responseBytes.min,
      apiStatements: item.apiStatements?.min ?? null,
      pureReadRepeats: item.pureReadRepeats?.min ?? null,
      clientSqlStatements: item.clientStatements?.min ?? null,
    }));
  return {
    scenarioCount: byScenario.length,
    wallMs: byScenario.reduce((sum, item) => sum + item.wallMs, 0),
    requests: byScenario.reduce((sum, item) => sum + item.requests, 0),
    conflicts: byScenario.reduce((sum, item) => sum + item.conflicts, 0),
    requestBytes: byScenario.reduce((sum, item) => sum + item.requestBytes, 0),
    responseBytes: byScenario.reduce(
      (sum, item) => sum + item.responseBytes,
      0,
    ),
    apiStatements: sumAllOrNull(byScenario.map((item) => item.apiStatements)),
    pureReadRepeats: sumAllOrNull(
      byScenario.map((item) => item.pureReadRepeats),
    ),
    clientSqlStatements: sumAllOrNull(
      byScenario.map((item) => item.clientSqlStatements),
    ),
    byScenario,
  };
}

/** Extracts PostgreSQL generic-plan screening counts from `perf:plans`. */
export async function extractPlansMetrics(
  path: string,
): Promise<EpochPlansMetrics> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const summaryValue = isObject(parsed) ? Reflect.get(parsed, "summary") : null;
  if (
    !isObject(parsed) ||
    Reflect.get(parsed, "scenario") !== "postgres-query-plans" ||
    !isObject(summaryValue) ||
    !Array.isArray(Reflect.get(summaryValue, "plans"))
  ) {
    throw new Error(`${path} is not a valid perf:plans report.`);
  }
  const summary = summaryValue as unknown as PlanReportSummary;
  const materializeQueries = summary.plans.filter((plan) =>
    plan.warnings.some((warning) => warning.kind === "Materialize"),
  ).length;
  const flagged = summary.plans
    .filter((plan) => plan.warnings.length > 0)
    .map((plan) => ({
      count: plan.count,
      warnings: [...new Set(plan.warnings.map((w) => w.kind))],
      sqlPrefix:
        plan.sql.length > 120 ? `${plan.sql.slice(0, 120)}…` : plan.sql,
    }));
  return {
    inspected: summary.inspected,
    planned: summary.planned,
    skipped: summary.skipped,
    seqScanQueries: summary.seqScanQueries,
    sortQueries: summary.sortQueries,
    materializeQueries,
    flagged,
  };
}

/** Extracts reload scaling summary rows from `perf:reload`. */
export async function extractReloadMetrics(
  path: string,
): Promise<readonly EpochReloadRow[]> {
  const summary = await readCompleteProbeSummary<{
    readonly documents: number;
    readonly folders: number;
    readonly reload: string;
    readonly medianRequests: number;
    readonly medianSettledMs: number;
    readonly medianStatements: number;
    readonly medianLocalStatements: number;
  }>(path, "document-reload");
  return summary.map((row) => ({
    documents: row.documents,
    folders: row.folders,
    reload: row.reload,
    medianRequests: row.medianRequests,
    medianSettledMs: round1(row.medianSettledMs),
    medianApiStatements: row.medianStatements,
    medianClientStatements: row.medianLocalStatements,
  }));
}

/** Extracts realtime interest summary rows from `perf:realtime`. */
export async function extractRealtimeMetrics(
  path: string,
): Promise<readonly EpochRealtimeRow[]> {
  const summary = await readCompleteProbeSummary<{
    readonly size: number;
    readonly pass: "declaration" | "revalidation";
    readonly medianDurationMs: number;
    readonly medianCpuMs: number;
    readonly statements: number;
    readonly roundTrips: number;
    readonly rows: number;
    readonly bytesReturned: number;
  }>(path, "realtime-container-interest");
  return summary.map((row) => ({
    size: row.size,
    pass: row.pass,
    medianDurationMs: round1(row.medianDurationMs),
    medianCpuMs: round1(row.medianCpuMs),
    statements: row.statements,
    roundTrips: row.roundTrips,
    rows: row.rows,
    bytesReturned: row.bytesReturned,
  }));
}

/** Extracts key rotation scaling summary rows from `perf:rotations`. */
export async function extractRotationMetrics(
  path: string,
): Promise<readonly EpochRotationRow[]> {
  const summary = await readCompleteProbeSummary<RotationSummaryRow>(
    path,
    "key-rotations",
  );
  return summary.map((row) => ({
    phase: row.phase,
    rotations: row.rotations,
    depth: row.depth,
    medianWallMs: round1(row.medianWallMs),
    medianRequests: row.medianRequests,
    maxConflicts: row.maxConflicts,
    medianPgStatements: row.medianPgStatements,
    medianLocalSqlCalls: row.medianLocalSqlCalls,
  }));
}

/** Extracts baseline staging scaling summary rows from `perf:baselines`. */
export async function extractBaselineMetrics(
  path: string,
): Promise<readonly EpochBaselineRow[]> {
  const summary = await readCompleteProbeSummary<BaselineSummaryRow>(
    path,
    "rotation-baselines",
  );
  return summary.map((row) => ({
    phase: row.phase,
    sizeMiB: row.sizeMiB,
    race: row.race,
    baselineMode: row.baselineMode,
    medianWallMs: round1(row.medianWallMs),
    medianRequests: row.medianRequests,
    maxConflicts: row.maxConflicts,
    medianPgStatements: row.medianPgStatements,
    medianLocalSqlCalls: row.medianLocalSqlCalls,
    peakRssDeltaMiB: round1(row.peakRssDeltaMiB),
  }));
}
