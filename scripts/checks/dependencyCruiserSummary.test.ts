import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectRuleExceptionCountsFromConfig,
  parseArgs,
  parseDependencyCruiserSummary,
  renderTextSummary
} from './dependencyCruiserSummary.ts';

test('parseArgs reads json and config options', () => {
  const options = parseArgs(['--json', '--config', 'tmp-config.json']);
  assert.equal(options.json, true);
  assert.equal(options.configPath, 'tmp-config.json');
});

test('collectRuleExceptionCountsFromConfig handles string and array pathNot', () => {
  const counts = collectRuleExceptionCountsFromConfig({
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
  });

  assert.deepEqual(counts, [
    { name: 'rule-a', pathNotEntries: 1, clientFileExceptions: 0 },
    { name: 'rule-b', pathNotEntries: 2, clientFileExceptions: 1 }
  ]);
});

test('parseDependencyCruiserSummary aggregates totals and violations', () => {
  const report = {
    summary: {
      totalCruised: 10,
      totalDependenciesCruised: 22,
      error: 1,
      warn: 1,
      info: 0,
      ignore: 0,
      violations: [
        { severity: 'error', rule: 'no-circular' },
        { severity: 'warn', rule: { name: 'no-cross-package' } },
        { severity: 'warn', rule: { name: 'no-cross-package' } }
      ]
    }
  };

  const config = {
    forbidden: [
      {
        name: 'no-cross-package-src-entrypoint-imports',
        from: {
          pathNot: ['^packages/client/src/pages/admin/index\\.ts$']
        }
      }
    ]
  };

  const parsed = parseDependencyCruiserSummary(report, config);

  assert.equal(parsed.totals.modulesCruised, 10);
  assert.equal(parsed.totals.dependenciesCruised, 22);
  assert.equal(parsed.totals.violations, 3);
  assert.equal(parsed.violationsByRule['no-circular'], 1);
  assert.equal(parsed.violationsByRule['no-cross-package'], 2);
  assert.equal(parsed.violationsBySeverity.warn, 2);
  assert.equal(parsed.ruleExceptionCounts[0]?.clientFileExceptions, 1);
  assert.equal(parsed.exceptionTotals.rulesWithPathNot, 1);
  assert.equal(parsed.exceptionTotals.totalPathNotEntries, 1);
  assert.equal(parsed.exceptionTotals.totalClientFileExceptions, 1);
});

test('renderTextSummary renders expected sections', () => {
  const text = renderTextSummary({
    totals: {
      modulesCruised: 1,
      dependenciesCruised: 2,
      errors: 0,
      warnings: 0,
      infos: 0,
      ignored: 0,
      violations: 0
    },
    violationsByRule: {},
    violationsBySeverity: {},
    ruleExceptionCounts: [
      {
        name: 'no-cross-package-src-entrypoint-imports',
        pathNotEntries: 14,
        clientFileExceptions: 13
      }
    ],
    exceptionTotals: {
      rulesWithPathNot: 1,
      totalPathNotEntries: 14,
      totalClientFileExceptions: 13
    }
  });

  assert.match(text, /Dependency Cruiser Summary/);
  assert.match(text, /Violations by rule: none/);
  assert.match(text, /Exception totals: rulesWithPathNot=1/);
  assert.match(text, /no-cross-package-src-entrypoint-imports/);
});
