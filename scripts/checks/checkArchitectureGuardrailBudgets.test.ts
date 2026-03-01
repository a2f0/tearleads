import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateGuardrailBudgets,
  parseDependencyCruiserExceptionTotals,
  parseDependencyCruiserRuleCounts,
  parseKnipIgnoreIssueFileCounts,
  parseKnipSuppressionTotals,
  parseKnipWorkspaceIgnoreDependencyCounts,
  renderGuardrailBudgetSummary
} from './checkArchitectureGuardrailBudgets.ts';

test('parseDependencyCruiserExceptionTotals and rule counts include pathNot data', () => {
  const config = {
    forbidden: [
      {
        name: 'rule-a',
        from: {
          pathNot: '(\\.test|\\.spec)\\.(ts|tsx)$'
        }
      },
      {
        name: 'rule-b',
        from: {
          pathNot: [
            '(\\.test|\\.spec)\\.(ts|tsx)$',
            '^packages/client/src/pages/admin/index\\.ts$'
          ]
        }
      }
    ]
  };

  const totals = parseDependencyCruiserExceptionTotals(config);
  assert.deepEqual(totals, {
    rulesWithPathNot: 2,
    totalPathNotEntries: 3,
    totalClientFileExceptions: 1
  });

  const ruleCounts = parseDependencyCruiserRuleCounts(config);
  assert.deepEqual(ruleCounts['rule-a'], {
    pathNotEntries: 1,
    clientFileExceptions: 0
  });
  assert.deepEqual(ruleCounts['rule-b'], {
    pathNotEntries: 2,
    clientFileExceptions: 1
  });
});

test('parseKnip suppression counters include per-file and per-workspace maps', () => {
  const config = {
    ignoreBinaries: ['shellcheck', 'playwright'],
    ignoreIssues: {
      'a.ts': ['exports', 'types'],
      'b.ts': ['classMembers']
    },
    workspaces: {
      a: {
        ignoreDependencies: ['alpha', 'beta']
      },
      b: {
        ignoreDependencies: ['gamma']
      },
      c: {}
    }
  };

  const totals = parseKnipSuppressionTotals(config);
  assert.deepEqual(totals, {
    ignoreIssueFiles: 2,
    ignoreIssueEntries: 3,
    ignoreBinaries: 2,
    workspaceIgnoreDependencyGroups: 2,
    workspaceIgnoreDependencyEntries: 3
  });

  assert.deepEqual(parseKnipIgnoreIssueFileCounts(config), {
    'a.ts': 2,
    'b.ts': 1
  });
  assert.deepEqual(parseKnipWorkspaceIgnoreDependencyCounts(config), {
    a: 2,
    b: 1
  });
});

test('evaluateGuardrailBudgets detects totals, rule, file, and workspace regressions', () => {
  const result = evaluateGuardrailBudgets(
    {
      rulesWithPathNot: 2,
      totalPathNotEntries: 4,
      totalClientFileExceptions: 4
    },
    {
      'no-circular': {
        pathNotEntries: 1,
        clientFileExceptions: 0
      }
    },
    {
      ignoreIssueFiles: 24,
      ignoreIssueEntries: 25,
      ignoreBinaries: 3,
      workspaceIgnoreDependencyGroups: 4,
      workspaceIgnoreDependencyEntries: 8
    },
    {
      'packages/client/src/lib/utils.ts': 2
    },
    {
      'packages/client': 6
    }
  );

  assert.equal(result.violations.length, 4);
  assert.deepEqual(result.violations.map((violation) => violation.key).sort(), [
    'dependencyCruiser.rules.no-circular.pathNotEntries',
    'dependencyCruiser.rulesWithPathNot',
    'knip.ignoreIssues.packages/client/src/lib/utils.ts',
    'knip.workspaces.packages/client.ignoreDependencies'
  ]);
});

test('renderGuardrailBudgetSummary includes pass status when within budget', () => {
  const result = evaluateGuardrailBudgets(
    {
      rulesWithPathNot: 1,
      totalPathNotEntries: 4,
      totalClientFileExceptions: 4
    },
    {
      'no-circular': {
        pathNotEntries: 0,
        clientFileExceptions: 0
      }
    },
    {
      ignoreIssueFiles: 24,
      ignoreIssueEntries: 25,
      ignoreBinaries: 3,
      workspaceIgnoreDependencyGroups: 4,
      workspaceIgnoreDependencyEntries: 8
    },
    {
      'packages/client/src/lib/utils.ts': 1
    },
    {
      'packages/client': 5
    }
  );

  const text = renderGuardrailBudgetSummary(result);
  assert.match(text, /Architecture Guardrail Budget Check/);
  assert.match(text, /Status: pass/);
  assert.match(text, /dependencyCruiser.totalPathNotEntries: 4\/4/);
  assert.match(text, /knip.ignoreIssueEntries: 25\/25/);
});
