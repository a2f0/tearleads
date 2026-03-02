import { performance } from 'node:perf_hooks';

interface QueryResultLike {
  rowCount?: number | null;
  rows?: unknown[];
}

export interface VfsCrdtQueryMetrics {
  count: number;
  durationMs: number;
  durationByLabel: Record<string, number>;
  rowCountByLabel: Record<string, number>;
}

type VfsCrdtPerfRoute =
  | 'push'
  | 'pull'
  | 'session'
  | 'snapshot_refresh';

interface BuildVfsCrdtRoutePerfMetricInput {
  route: VfsCrdtPerfRoute;
  success: boolean;
  durationMs: number;
  queryMetrics: VfsCrdtQueryMetrics;
  operationCount?: number;
  resultCount?: number;
  error?: unknown;
  occurredAt?: Date;
}

interface VfsCrdtRoutePerfMetric {
  metricVersion: 1;
  event: 'vfs_crdt_route_perf';
  occurredAt: string;
  route: VfsCrdtPerfRoute;
  success: boolean;
  durationMs: number;
  queryCount: number;
  queryDurationMs: number;
  queryDurationByLabel: Record<string, number>;
  queryRowCountByLabel: Record<string, number>;
  operationCount: number | null;
  resultCount: number | null;
  error: string | null;
}

function normalizeErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }

  return null;
}

function parseMetricEnv(value: string | undefined): boolean {
  if (value === undefined || value.trim().length === 0) {
    return process.env['NODE_ENV'] !== 'test';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === 'false') {
    return false;
  }

  throw new Error(
    'VFS_CRDT_PERF_METRICS must be one of: true, false, 1, 0'
  );
}

function toNonNegativeInteger(value: number | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.trunc(value);
}

function toRoundedDurationMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value * 1000) / 1000;
}

function parseRowCount(result: QueryResultLike): number {
  if (typeof result.rowCount === 'number' && Number.isFinite(result.rowCount)) {
    return Math.max(0, Math.trunc(result.rowCount));
  }

  if (Array.isArray(result.rows)) {
    return result.rows.length;
  }

  return 0;
}

function addMetricValue(
  map: Record<string, number>,
  key: string,
  value: number
): void {
  const current = map[key] ?? 0;
  map[key] = current + value;
}

function recordQueryMetric(
  metrics: VfsCrdtQueryMetrics,
  label: string,
  durationMs: number,
  rowCount: number
): void {
  metrics.count += 1;
  metrics.durationMs += durationMs;
  addMetricValue(metrics.durationByLabel, label, durationMs);
  addMetricValue(metrics.rowCountByLabel, label, rowCount);
}

export function createVfsCrdtQueryMetrics(): VfsCrdtQueryMetrics {
  return {
    count: 0,
    durationMs: 0,
    durationByLabel: {},
    rowCountByLabel: {}
  };
}

export async function runTimedVfsCrdtQuery<TResult extends QueryResultLike>(
  label: string,
  metrics: VfsCrdtQueryMetrics,
  run: () => Promise<TResult>
): Promise<TResult> {
  const startedAtMs = performance.now();
  try {
    const result = await run();
    const durationMs = performance.now() - startedAtMs;
    recordQueryMetric(metrics, label, durationMs, parseRowCount(result));
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAtMs;
    recordQueryMetric(metrics, label, durationMs, 0);
    throw error;
  }
}

export function mergeVfsCrdtQueryMetrics(
  ...sources: VfsCrdtQueryMetrics[]
): VfsCrdtQueryMetrics {
  const merged = createVfsCrdtQueryMetrics();

  for (const source of sources) {
    merged.count += source.count;
    merged.durationMs += source.durationMs;
    for (const [label, duration] of Object.entries(source.durationByLabel)) {
      addMetricValue(merged.durationByLabel, label, duration);
    }
    for (const [label, rowCount] of Object.entries(source.rowCountByLabel)) {
      addMetricValue(merged.rowCountByLabel, label, rowCount);
    }
  }

  return merged;
}

function buildVfsCrdtRoutePerfMetric(
  input: BuildVfsCrdtRoutePerfMetricInput
): VfsCrdtRoutePerfMetric {
  const durationByLabel: Record<string, number> = {};
  for (const [label, durationMs] of Object.entries(
    input.queryMetrics.durationByLabel
  )) {
    durationByLabel[label] = toRoundedDurationMs(durationMs);
  }

  const rowCountByLabel: Record<string, number> = {};
  for (const [label, rowCount] of Object.entries(
    input.queryMetrics.rowCountByLabel
  )) {
    rowCountByLabel[label] = Math.max(0, Math.trunc(rowCount));
  }

  return {
    metricVersion: 1,
    event: 'vfs_crdt_route_perf',
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    route: input.route,
    success: input.success,
    durationMs: toRoundedDurationMs(input.durationMs),
    queryCount: Math.max(0, Math.trunc(input.queryMetrics.count)),
    queryDurationMs: toRoundedDurationMs(input.queryMetrics.durationMs),
    queryDurationByLabel: durationByLabel,
    queryRowCountByLabel: rowCountByLabel,
    operationCount: toNonNegativeInteger(input.operationCount),
    resultCount: toNonNegativeInteger(input.resultCount),
    error: normalizeErrorMessage(input.error)
  };
}

export function emitVfsCrdtRoutePerfMetric(
  input: BuildVfsCrdtRoutePerfMetricInput
): void {
  let metricsEnabled = false;
  try {
    metricsEnabled = parseMetricEnv(process.env['VFS_CRDT_PERF_METRICS']);
  } catch (error) {
    console.error('Invalid VFS_CRDT_PERF_METRICS value; skipping metric', error);
    return;
  }

  if (!metricsEnabled) {
    return;
  }

  console.info(JSON.stringify(buildVfsCrdtRoutePerfMetric(input)));
}
