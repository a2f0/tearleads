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

test('runImpactedTests dry-run skips ciImpact script tests for unrelated script changes', () => {
  const result = runImpactedTests([
    '--files',
    'scripts/postgres/reset.sh',
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

test('runImpactedTests skips impacted tests for ignored health vitest config edits', () => {
  const result = runImpactedTests([
    '--files',
    'packages/health/vitest.config.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: no material changes, skipping impacted tests\./
  );
});

test('runImpactedTests ignores exact-ignored files when computing targets', () => {
  const result = runImpactedTests([
    '--files',
    'packages/health/vitest.config.ts',
    '--dry-run',
    '--print-targets-json'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  const parsed = JSON.parse(stdoutText(result));
  assert.deepEqual(Reflect.get(parsed, 'targets'), []);
  assert.equal(Reflect.get(parsed, 'hasMaterialChanges'), false);
});

test('runImpactedTests dry-run includes contacts coverage when contacts changes', () => {
  const result = runImpactedTests([
    '--files',
    'packages/contacts/src/components/ContactsGroupsSidebar.tsx',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(
    stdoutText(result),
    /ci-impact: targets => .*@tearleads\/contacts/
  );
});

test('runImpactedTests dry-run skips coverage for test-only package changes', () => {
  const result = runImpactedTests([
    '--files',
    'packages/contacts/src/components/ContactsGroupsSidebar.test.tsx',
    '--dry-run',
    '--print-targets-json'
  ]);
  assert.equal(result.status, 0, stderrText(result));

  const stdout = stdoutText(result);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(Reflect.get(parsed, 'targets'), []);
  assert.equal(Reflect.get(parsed, 'fullRun'), false);
});

test('runImpactedTests dry-run includes cli coverage when cli changes', () => {
  const result = runImpactedTests([
    '--files',
    'packages/cli/src/db/adapter.ts',
    '--dry-run'
  ]);
  assert.equal(result.status, 0, stderrText(result));
  assert.match(stdoutText(result), /ci-impact: targets => .*@tearleads\/cli/);
});

test('runImpactedTests emits target JSON for automation consumers', () => {
  const result = runImpactedTests([
    '--files',
    'packages/cli/src/db/adapter.ts',
    '--dry-run',
    '--print-targets-json'
  ]);
  assert.equal(result.status, 0, stderrText(result));

  const stdout = stdoutText(result);
  const parsed = JSON.parse(stdout);
  if (typeof parsed !== 'object' || parsed === null) {
    assert.fail('Expected JSON object output');
  }

  assert.equal(Array.isArray(Reflect.get(parsed, 'targets')), true);
  assert.equal(Reflect.get(parsed, 'hasMaterialChanges'), true);
  assert.equal(Reflect.get(parsed, 'fullRun'), false);
  assert.equal(Reflect.get(parsed, 'runScriptTests'), false);
  assert.deepEqual(Reflect.get(parsed, 'targets'), ['@tearleads/cli']);
});

test('runImpactedTests dry-run treats build workflow edits as non-full-run exception', () => {
  const result = runImpactedTests([
    '--files',
    '.github/workflows/build.yml',
    '--dry-run',
    '--print-targets-json'
  ]);
  assert.equal(result.status, 0, stderrText(result));

  const stdout = stdoutText(result);
  const parsed = JSON.parse(stdout);
  assert.equal(Reflect.get(parsed, 'fullRun'), false);
  assert.deepEqual(Reflect.get(parsed, 'targets'), []);
});

test('runImpactedTests dry-run includes package tests when test infrastructure changes', () => {
  const result = runImpactedTests([
    '--files',
    'packages/analytics/src/test/clientCompat/db.ts',
    '--dry-run',
    '--print-targets-json'
  ]);
  assert.equal(result.status, 0, stderrText(result));

  const stdout = stdoutText(result);
  const parsed = JSON.parse(stdout);
  const targets: unknown = Reflect.get(parsed, 'targets');
  assert.ok(
    Array.isArray(targets) && targets.includes('@tearleads/analytics'),
    `Expected targets to include @tearleads/analytics, got: ${JSON.stringify(targets)}`
  );
});

test('runImpactedTests dry-run avoids global fanout for high-risk script config changes', () => {
  const result = runImpactedTests([
    '--files',
    'scripts/tsconfig.json',
    '--dry-run',
    '--print-targets-json'
  ]);
  assert.equal(result.status, 0, stderrText(result));

  const stdout = stdoutText(result);
  const parsed = JSON.parse(stdout);
  assert.equal(Reflect.get(parsed, 'fullRun'), true);
  assert.deepEqual(Reflect.get(parsed, 'targets'), []);
});

test('runImpactedTests fails closed when ciImpact cannot diff base/head', () => {
  const result = runImpactedTests([
    '--base',
    'not-a-real-ref',
    '--head',
    'HEAD',
    '--dry-run',
    '--scripts-only'
  ]);
  assert.equal(result.status, 1);
  assert.match(
    stderrText(result),
    /unable to compute a reliable diff for impacted test selection; failing closed/
  );
});
