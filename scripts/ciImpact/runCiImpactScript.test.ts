import assert from 'node:assert/strict';
import test from 'node:test';
import { runCiImpactScript } from './runCiImpactScript.ts';

function parseJsonOutput(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    assert.fail('Expected ciImpact output to be a JSON object');
  }
  return parsed;
}

test('runCiImpactScript returns ciImpact output for explicit files input', () => {
  const output = runCiImpactScript({
    base: 'HEAD',
    head: 'HEAD',
    files: 'docs/en/ci.md',
    callerName: 'runCiImpactScript.test'
  });
  const parsed = parseJsonOutput(output);
  assert.equal(Array.isArray(Reflect.get(parsed, 'changedFiles')), true);
  assert.equal(Array.isArray(Reflect.get(parsed, 'materialFiles')), true);
  assert.equal(typeof Reflect.get(parsed, 'jobs'), 'object');
});

test('runCiImpactScript returns ciImpact output without explicit files input', () => {
  const output = runCiImpactScript({
    base: 'HEAD',
    head: 'HEAD',
    callerName: 'runCiImpactScript.test'
  });
  const parsed = parseJsonOutput(output);
  assert.equal(Array.isArray(Reflect.get(parsed, 'changedFiles')), true);
  assert.equal(Array.isArray(Reflect.get(parsed, 'warnings')), true);
  assert.equal(typeof Reflect.get(parsed, 'jobs'), 'object');
});
