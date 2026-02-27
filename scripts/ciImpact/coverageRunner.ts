import { spawnSync } from 'node:child_process';

const DEFAULT_MAX_WORKERS = 4;
const PACKAGE_WORKER_CAPS = new Map<string, number>([
  ['@tearleads/api-client', 1],
  ['@tearleads/client', 1]
]);

function parseCoverageTimeoutMs(): number {
  const raw = process.env['PRE_PUSH_COVERAGE_TIMEOUT_MINUTES'];
  if (raw === undefined) {
    return 20 * 60 * 1000;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20 * 60 * 1000;
  }
  return parsed * 60 * 1000;
}

function parseGlobalMaxWorkers(): number {
  const raw = process.env['PRE_PUSH_VITEST_MAX_WORKERS'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_WORKERS;
}

function parsePackageCaps(): Map<string, number> {
  const result = new Map(PACKAGE_WORKER_CAPS);
  const raw = process.env['PRE_PUSH_VITEST_MAX_WORKERS_BY_PACKAGE'];
  if (!raw) {
    return result;
  }

  for (const entry of raw.split(',')) {
    const [pkg, workers] = entry.split('=');
    if (!pkg || !workers) {
      continue;
    }
    const parsed = Number.parseInt(workers.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      result.set(pkg.trim(), parsed);
    }
  }
  return result;
}

function resolveVitestMaxWorkersArg(pkg: string): string {
  const globalWorkers = parseGlobalMaxWorkers();
  const packageCap = parsePackageCaps().get(pkg);
  const effectiveWorkers =
    typeof packageCap === 'number'
      ? Math.min(globalWorkers, packageCap)
      : globalWorkers;
  return `--maxWorkers=${effectiveWorkers}`;
}

export function runCoverageForPackage(pkg: string): void {
  const timeoutMs = parseCoverageTimeoutMs();
  const maxWorkersArg = resolveVitestMaxWorkersArg(pkg);
  const env = {
    ...process.env,
    TEARLEADS_PREPUSH_MINIMAL_COVERAGE_REPORTERS: '1'
  };
  const result = spawnSync(
    'pnpm',
    ['--filter', pkg, 'test:coverage', '--', maxWorkersArg],
    {
      stdio: 'inherit',
      env,
      timeout: timeoutMs,
      killSignal: 'SIGTERM'
    }
  );

  if (result.error?.name === 'TimeoutError') {
    throw new Error(
      `ci-impact: timed out after ${Math.floor(timeoutMs / 60000)}m running coverage for ${pkg}.`
    );
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      `ci-impact: coverage for ${pkg} exited with status ${result.status}.`
    );
  }

  if (result.status === null) {
    const signal =
      typeof result.signal === 'string' && result.signal.length > 0
        ? result.signal
        : 'unknown';
    throw new Error(
      `ci-impact: coverage for ${pkg} ended by signal ${signal}.`
    );
  }
}
