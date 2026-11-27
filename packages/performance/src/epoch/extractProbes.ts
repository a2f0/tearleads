import { readFile } from "node:fs/promises";
import { loadScenarioReport } from "../scenarios/report";
import type {
  EpochBaselineRow,
  EpochPlansMetrics,
  EpochRealtimeRow,
  EpochReloadRow,
  EpochRotationRow,
  EpochScenariosMetrics,
} from "./schema";
import {
  isObject,
  requireBoolean,
  requireFiniteNumber,
  requireNullableString,
  requireObject,
  requireRealtimePass,
  requireString,
} from "./validate";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sumAllOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) {
    return null;
  }
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

async function readCompleteProbeSummary(
  path: string,
  expectedScenario: string,
): Promise<readonly Record<string, unknown>[]> {
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
  return summary.map((row, index) =>
    requireObject(row, `${path} summary[${index}]`),
  );
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

function extractPlanWarnings(
  planRecord: Record<string, unknown>,
  path: string,
): string[] {
  const warningsValue = Reflect.get(planRecord, "warnings");
  if (!Array.isArray(warningsValue)) {
    throw new Error(`${path} plan entry is missing a warnings array.`);
  }
  return warningsValue.map((warning, index) =>
    requireString(
      requireObject(warning, `${path} warnings[${index}]`),
      "kind",
      path,
    ),
  );
}

/** Extracts PostgreSQL generic-plan screening counts from `perf:plans`. */
export async function extractPlansMetrics(
  path: string,
): Promise<EpochPlansMetrics> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const summaryValue = isObject(parsed) ? Reflect.get(parsed, "summary") : null;
  const plansValue = isObject(summaryValue)
    ? Reflect.get(summaryValue, "plans")
    : null;
  if (
    !isObject(parsed) ||
    Reflect.get(parsed, "scenario") !== "postgres-query-plans" ||
    !isObject(summaryValue) ||
    !Array.isArray(plansValue)
  ) {
    throw new Error(`${path} is not a valid perf:plans report.`);
  }
  const plans = plansValue.map((entry, index) => {
    const planRecord = requireObject(entry, `${path} plans[${index}]`);
    return {
      count: requireFiniteNumber(planRecord, "count", path),
      sql: requireString(planRecord, "sql", path),
      warnings: extractPlanWarnings(planRecord, path),
    };
  });
  const materializeQueries = plans.filter((plan) =>
    plan.warnings.includes("Materialize"),
  ).length;
  const flagged = plans
    .filter((plan) => plan.warnings.length > 0)
    .map((plan) => ({
      count: plan.count,
      warnings: [...new Set(plan.warnings)],
      sqlPrefix:
        plan.sql.length > 120 ? `${plan.sql.slice(0, 120)}…` : plan.sql,
    }));
  return {
    inspected: requireFiniteNumber(summaryValue, "inspected", path),
    planned: requireFiniteNumber(summaryValue, "planned", path),
    skipped: requireFiniteNumber(summaryValue, "skipped", path),
    seqScanQueries: requireFiniteNumber(summaryValue, "seqScanQueries", path),
    sortQueries: requireFiniteNumber(summaryValue, "sortQueries", path),
    materializeQueries,
    flagged,
  };
}

/** Extracts reload scaling summary rows from `perf:reload`. */
export async function extractReloadMetrics(
  path: string,
): Promise<readonly EpochReloadRow[]> {
  const summary = await readCompleteProbeSummary(path, "document-reload");
  return summary.map((row) => ({
    documents: requireFiniteNumber(row, "documents", path),
    folders: requireFiniteNumber(row, "folders", path),
    reload: requireString(row, "reload", path),
    medianRequests: requireFiniteNumber(row, "medianRequests", path),
    medianSettledMs: round1(requireFiniteNumber(row, "medianSettledMs", path)),
    medianApiStatements: requireFiniteNumber(row, "medianStatements", path),
    medianClientStatements: requireFiniteNumber(
      row,
      "medianLocalStatements",
      path,
    ),
  }));
}

/** Extracts realtime interest summary rows from `perf:realtime`. */
export async function extractRealtimeMetrics(
  path: string,
): Promise<readonly EpochRealtimeRow[]> {
  const summary = await readCompleteProbeSummary(
    path,
    "realtime-container-interest",
  );
  return summary.map((row) => ({
    size: requireFiniteNumber(row, "size", path),
    pass: requireRealtimePass(row, path),
    medianDurationMs: round1(
      requireFiniteNumber(row, "medianDurationMs", path),
    ),
    medianCpuMs: round1(requireFiniteNumber(row, "medianCpuMs", path)),
    statements: requireFiniteNumber(row, "statements", path),
    roundTrips: requireFiniteNumber(row, "roundTrips", path),
    rows: requireFiniteNumber(row, "rows", path),
    bytesReturned: requireFiniteNumber(row, "bytesReturned", path),
  }));
}

/** Extracts key rotation scaling summary rows from `perf:rotations`. */
export async function extractRotationMetrics(
  path: string,
): Promise<readonly EpochRotationRow[]> {
  const summary = await readCompleteProbeSummary(path, "key-rotations");
  return summary.map((row) => ({
    phase: requireString(row, "phase", path),
    rotations: requireFiniteNumber(row, "rotations", path),
    depth: requireFiniteNumber(row, "depth", path),
    medianWallMs: round1(requireFiniteNumber(row, "medianWallMs", path)),
    medianRequests: requireFiniteNumber(row, "medianRequests", path),
    maxConflicts: requireFiniteNumber(row, "maxConflicts", path),
    medianPgStatements: requireFiniteNumber(row, "medianPgStatements", path),
    medianLocalSqlCalls: requireFiniteNumber(row, "medianLocalSqlCalls", path),
  }));
}

/** Extracts baseline staging scaling summary rows from `perf:baselines`. */
export async function extractBaselineMetrics(
  path: string,
): Promise<readonly EpochBaselineRow[]> {
  const summary = await readCompleteProbeSummary(path, "rotation-baselines");
  return summary.map((row) => ({
    phase: requireString(row, "phase", path),
    sizeMiB: requireFiniteNumber(row, "sizeMiB", path),
    race: requireBoolean(row, "race", path),
    baselineMode: requireNullableString(row, "baselineMode", path),
    medianWallMs: round1(requireFiniteNumber(row, "medianWallMs", path)),
    medianRequests: requireFiniteNumber(row, "medianRequests", path),
    maxConflicts: requireFiniteNumber(row, "maxConflicts", path),
    medianPgStatements: requireFiniteNumber(row, "medianPgStatements", path),
    medianLocalSqlCalls: requireFiniteNumber(row, "medianLocalSqlCalls", path),
    peakRssDeltaMiB: round1(requireFiniteNumber(row, "peakRssDeltaMiB", path)),
  }));
}
