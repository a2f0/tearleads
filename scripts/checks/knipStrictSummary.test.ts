import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseKnipIssues,
  renderKnipSummary,
  summarizeKnipIssues
} from './knipStrictSummary.ts';

test('parseKnipIssues extracts known issue fields', () => {
  const issues = parseKnipIssues({
    issues: [
      {
        severity: 'error',
        workspace: 'packages/client',
        file: 'packages/client/package.json',
        issueType: 'dependencies'
      },
      {
        severity: 'warning',
        workspace: 'packages/api',
        file: 'packages/api/package.json',
        issueType: 'unlisted'
      }
    ]
  });

  assert.equal(issues.length, 2);
  assert.equal(issues[0]?.issueType, 'dependencies');
  assert.equal(issues[1]?.severity, 'warning');
});

test('summarizeKnipIssues aggregates totals and buckets', () => {
  const result = summarizeKnipIssues([
    {
      severity: 'error',
      workspace: 'packages/client',
      file: 'a',
      issueType: 'dependencies'
    },
    {
      severity: 'warning',
      workspace: 'packages/client',
      file: 'b',
      issueType: 'dependencies'
    },
    {
      severity: 'warn',
      workspace: 'packages/api',
      file: 'c',
      issueType: 'unlisted'
    }
  ]);

  assert.equal(result.totals.issues, 3);
  assert.equal(result.totals.errors, 1);
  assert.equal(result.totals.warnings, 2);
  assert.equal(result.byIssueType.dependencies, 2);
  assert.equal(result.byIssueType.unlisted, 1);
  assert.equal(result.byWorkspace['packages/client'], 2);
  assert.equal(result.byWorkspace['packages/api'], 1);
});

test('renderKnipSummary includes empty-state sections', () => {
  const text = renderKnipSummary({
    totals: {
      issues: 0,
      errors: 0,
      warnings: 0
    },
    byIssueType: {},
    byWorkspace: {}
  });

  assert.match(text, /Knip Strict Summary/);
  assert.match(text, /By issue type: none/);
  assert.match(text, /By workspace: none/);
});
