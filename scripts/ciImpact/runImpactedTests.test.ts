import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runImpactedTests(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    'node',
    ['--import', 'tsx', 'scripts/ciImpact/runImpactedTests.ts', ...args],
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

test('runImpactedTests dry-run selects ciImpact script tests for ciImpact changes', () => {
  const result = runImpactedTests([
    '--files',
    'scripts/ciImpact/ciImpact.ts',
    '--dry-run',
    '--scripts-only'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: running ciImpact script tests\./
  );
  assert.match(stdoutText(result), /ci-impact: scripts-only mode enabled\./);
});

test('runImpactedTests dry-run skips ciImpact script tests for unrelated package changes', () => {
  const result = runImpactedTests([
    '--files',
    'packages/shared/src/index.ts',
    '--dry-run',
    '--scripts-only'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: no impacted ciImpact script tests\./
  );
});

test('runImpactedTests skips impacted tests when all changes are non-material', () => {
  const result = runImpactedTests(['--files', 'docs/en/ci.md', '--dry-run']);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: no material changes, skipping impacted tests\./
  );
});
