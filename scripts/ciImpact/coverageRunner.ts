import { spawnSync } from 'node:child_process';

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

function parseVitestMaxWorkersArg(): string {
  const raw = process.env['PRE_PUSH_VITEST_MAX_WORKERS'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return `--maxWorkers=${raw.trim()}`;
  }
  return '--maxWorkers=4';
}

export function runCoverageForPackage(pkg: string): void {
  const timeoutMs = parseCoverageTimeoutMs();
  const maxWorkersArg = parseVitestMaxWorkersArg();
  const result = spawnSync(
    'pnpm',
    ['--filter', pkg, 'test:coverage', '--', maxWorkersArg],
    {
      stdio: 'inherit',
      env: process.env,
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
    process.exit(result.status);
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
