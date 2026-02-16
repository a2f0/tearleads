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

test('runImpactedQuality dry-run flags script TypeScript changes for typecheck', () => {
  const result = runImpactedQuality([
    '--files',
    'scripts/checkPort.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: script TypeScript changes detected\./
  );
});

test('runImpactedQuality dry-run does not flag script typecheck for package-only changes', () => {
  const result = runImpactedQuality([
    '--files',
    'packages/shared/src/index.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.doesNotMatch(
    stdoutText(result),
    /ci-impact: script TypeScript changes detected\./
  );
});
