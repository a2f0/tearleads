import { readFile } from "node:fs/promises";
import type { BaselineSummaryRow } from "../baselines/summary";
import type { PlanReportSummary } from "../plans/planAnalysis";
import type { RotationSummaryRow } from "../rotations/summary";
import type { ScenarioReport } from "../scenarios/report";
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

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Extracts multi-party bob-and-alice scenario totals from `perf:scenarios`. */
export async function extractScenariosMetrics(
  path: string,
): Promise<EpochScenariosMetrics> {
  const report = await readJsonFile<ScenarioReport>(path);
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
    apiStatements: byScenario.reduce(
      (sum, item) => sum + (item.apiStatements ?? 0),
      0,
    ),
    pureReadRepeats: byScenario.reduce(
      (sum, item) => sum + (item.pureReadRepeats ?? 0),
      0,
    ),
    clientSqlStatements: byScenario.reduce(
      (sum, item) => sum + (item.clientSqlStatements ?? 0),
      0,
    ),
    byScenario,
  };
}

/** Extracts PostgreSQL generic-plan screening counts from `perf:plans`. */
export async function extractPlansMetrics(
  path: string,
): Promise<EpochPlansMetrics> {
  const report = await readJsonFile<{ readonly summary: PlanReportSummary }>(
    path,
  );
  const { summary } = report;
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
  const report = await readJsonFile<{
    readonly summary: readonly {
      readonly documents: number;
      readonly folders: number;
      readonly reload: string;
      readonly medianRequests: number;
      readonly medianSettledMs: number;
      readonly medianStatements: number;
      readonly medianLocalStatements: number;
    }[];
  }>(path);
  return report.summary.map((row) => ({
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
  const report = await readJsonFile<{
    readonly summary: readonly {
      readonly size: number;
      readonly pass: "declaration" | "revalidation";
      readonly medianDurationMs: number;
      readonly medianCpuMs: number;
      readonly statements: number;
      readonly roundTrips: number;
      readonly rows: number;
      readonly bytesReturned: number;
    }[];
  }>(path);
  return report.summary.map((row) => ({
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
  const report = await readJsonFile<{
    readonly summary: readonly RotationSummaryRow[];
  }>(path);
  return report.summary.map((row) => ({
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
  const report = await readJsonFile<{
    readonly summary: readonly BaselineSummaryRow[];
  }>(path);
  return report.summary.map((row) => ({
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
