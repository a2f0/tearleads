import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runImpactedQuality(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    'node',
    ['--import', 'tsx', 'scripts/ciImpact/runImpactedQuality.ts', ...args],
    {
      encoding: 'utf8'
    }
  );
}

function stdoutText(result: ReturnType<typeof spawnSync>): string {
  return typeof result.stdout === 'string' ? result.stdout : '';
}

function stderrText(result: ReturnType<typeof spawnSync>): string {
  return typeof result.stderr === 'string' ? result.stderr : '';
}

test('runImpactedQuality dry-run reports baseline scripts typecheck guard', () => {
  const result = runImpactedQuality([
    '--files',
    'scripts/lib/checkPort.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: running scripts TypeScript check \(baseline pre-push guard\)\./
  );
});

test('runImpactedQuality dry-run runs baseline scripts typecheck for package-only changes', () => {
  const result = runImpactedQuality([
    '--files',
    'packages/shared/src/index.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: running scripts TypeScript check \(baseline pre-push guard\)\./
  );
});

test('runImpactedQuality dry-run enters full quality mode for scripts tsconfig changes', () => {
  const result = runImpactedQuality([
    '--files',
    'scripts/tsconfig.json',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: high-risk changes detected, running full quality pipeline\./
  );
});

test('runImpactedQuality dry-run uses selective mode for ciImpact script edits', () => {
  const result = runImpactedQuality([
    '--files',
    'scripts/ciImpact/runImpactedQuality.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(stdoutText(result), /ci-impact: selective quality checks enabled\./);
});
