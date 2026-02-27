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

test('runImpactedQuality dry-run runs scripts typecheck when scripts change', () => {
  const result = runImpactedQuality([
    '--files',
    'scripts/lib/checkPort.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: running scripts TypeScript check \(scripts changed\)\./
  );
});

test('runImpactedQuality dry-run skips scripts typecheck for package-only changes', () => {
  const result = runImpactedQuality([
    '--files',
    'packages/shared/src/index.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: no script changes, skipping scripts TypeScript check\./
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
  assert.match(
    stdoutText(result),
    /ci-impact: selective quality checks enabled\./
  );
});

test('runImpactedQuality dry-run reports changed ansible lint targets', () => {
  const result = runImpactedQuality([
    '--files',
    'ansible/playbooks/developerLaptop.yml',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: ansible targets => ansible\/playbooks\/developerLaptop\.yml/
  );
});
