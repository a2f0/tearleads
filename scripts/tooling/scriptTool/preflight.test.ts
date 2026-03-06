import assert from 'node:assert/strict';
import test from 'node:test';
import { runPreflight } from './preflight.ts';

const repoRoot = process.cwd();

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

test('runPreflight(runElectron) reports selected package manager', () => {
  withEnv('TEARLEADS_PM', undefined, () => {
    const checks = runPreflight('runElectron', {}, repoRoot);
    assert.equal(checks.length, 1);
    assert.match(checks[0] ?? '', /^preflight: (pnpm|bun) is available$/);
  });
});

test('runPreflight(runElectron) rejects invalid TEARLEADS_PM', () => {
  withEnv('TEARLEADS_PM', 'invalid', () => {
    assert.throws(
      () => runPreflight('runElectron', {}, repoRoot),
      /TEARLEADS_PM must be "pnpm" or "bun"/
    );
  });
});

test('runPreflight(runElectron) honors TEARLEADS_PM=pnpm', () => {
  withEnv('TEARLEADS_PM', 'pnpm', () => {
    const checks = runPreflight('runElectron', {}, repoRoot);
    assert.deepEqual(checks, ['preflight: pnpm is available']);
  });
});
