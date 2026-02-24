import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { ALL_JOB_NAMES, type JobName } from './workflowConfig.js';

interface JobState {
  run: boolean;
  reasons: string[];
}

interface CiImpactOutput {
  base: string;
  head: string;
  changedFiles: string[];
  materialFiles: string[];
  jobs: Record<JobName, JobState>;
  warnings: string[];
}

interface Scenario {
  name: string;
  files: string[];
  expectedRuns: Record<JobName, boolean>;
}

function runCiImpactWithArgs(args: string[]): CiImpactOutput {
  const output = execFileSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/ciImpact/ciImpact.ts', ...args],
    {
      encoding: 'utf8'
    }
  );
  const parsed = JSON.parse(output);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('ciImpact output must be a JSON object');
  }

  return parsed;
}

function runCiImpact(files: string[]): CiImpactOutput {
  return runCiImpactWithArgs(['--files', files.join(',')]);
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    name: 'docs-only change',
    files: ['docs/en/ci.md'],
    expectedRuns: {
      build: false,
      'web-e2e': false,
      'website-e2e': false,
      'electron-e2e': false,
      android: false,
      'android-maestro-release': false,
      'ios-maestro-release': false
    }
  },
  {
    name: 'workflow change triggers full matrix',
    files: ['.github/workflows/build.yml'],
    expectedRuns: {
      build: true,
      'web-e2e': true,
      'website-e2e': true,
      'electron-e2e': true,
      android: true,
      'android-maestro-release': true,
      'ios-maestro-release': true
    }
  },
  {
    name: 'deploy workflow-only change does not trigger integration matrix',
    files: ['.github/workflows/deploy-desktop.yml'],
    expectedRuns: {
      build: true,
      'web-e2e': false,
      'website-e2e': false,
      'electron-e2e': false,
      android: false,
      'android-maestro-release': false,
      'ios-maestro-release': false
    }
  },
  {
    name: 'API-only change',
    files: ['packages/api/src/index.ts'],
    expectedRuns: {
      build: true,
      'web-e2e': true,
      'website-e2e': true,
      'electron-e2e': false,
      android: false,
      'android-maestro-release': false,
      'ios-maestro-release': false
    }
  },
  {
    name: 'website-only change',
    files: ['packages/website/src/index.ts'],
    expectedRuns: {
      build: true,
      'web-e2e': false,
      'website-e2e': true,
      'electron-e2e': false,
      android: false,
      'android-maestro-release': false,
      'ios-maestro-release': false
    }
  },
  {
    name: 'android-only native change',
    files: ['packages/client/android/app/src/main/AndroidManifest.xml'],
    expectedRuns: {
      build: true,
      'web-e2e': true,
      'website-e2e': false,
      'electron-e2e': true,
      android: true,
      'android-maestro-release': true,
      'ios-maestro-release': false
    }
  },
  {
    name: 'ios-only native change',
    files: ['packages/client/ios/App/AppDelegate.swift'],
    expectedRuns: {
      build: true,
      'web-e2e': true,
      'website-e2e': false,
      'electron-e2e': true,
      android: false,
      'android-maestro-release': false,
      'ios-maestro-release': true
    }
  }
];

for (const scenario of scenarios) {
  test(`ciImpact decision: ${scenario.name}`, () => {
    const output = runCiImpact(scenario.files);
    for (const jobName of ALL_JOB_NAMES) {
      assert.equal(
        output.jobs[jobName].run,
        scenario.expectedRuns[jobName],
        `${scenario.name}: expected ${jobName}=${scenario.expectedRuns[jobName]}`
      );
    }
  });
}

test('ciImpact docs-only change emits ignored-path warning', () => {
  const output = runCiImpact(['docs/en/ci.md']);
  assert.deepEqual(output.materialFiles, []);
  assert.ok(
    output.warnings.includes(
      'All file changes are ignored by trigger policy (docs/config-only).'
    ),
    'docs-only change should explain why jobs were skipped'
  );
});

test('ciImpact fallback diff path works when base ref is invalid', () => {
  const output = runCiImpactWithArgs([
    '--base',
    'not-a-real-ref',
    '--head',
    'HEAD'
  ]);
  assert.equal(output.base, 'not-a-real-ref');
  assert.equal(output.head, 'HEAD');
  assert.deepEqual(output.changedFiles, ['.github/workflows/build.yml']);
  assert.ok(
    output.warnings.some((warning) =>
      warning.includes(
        'Unable to diff not-a-real-ref...HEAD; forcing conservative full-run sentinel.'
      )
    )
  );
});

test('ciImpact returns empty change set when base/head are identical', () => {
  const output = runCiImpactWithArgs(['--base', 'HEAD', '--head', 'HEAD']);
  assert.deepEqual(output.changedFiles, []);
  assert.deepEqual(output.materialFiles, []);
});

test('ciImpact warns for unmapped files under packages/', () => {
  const output = runCiImpactWithArgs([
    '--files',
    'packages/not-a-workspace/src/index.ts'
  ]);
  assert.ok(
    output.warnings.includes(
      'Some files under packages/ did not map to a package.json workspace.'
    ),
    'expected unmapped workspace warning'
  );
});

test('ciImpact handles tuxedo-only changes without mobile jobs', () => {
  const output = runCiImpactWithArgs(['--files', 'tuxedo/tests/run.sh']);
  assert.equal(output.jobs.build.run, true);
  assert.equal(output.jobs.android.run, false);
  assert.equal(output.jobs['android-maestro-release'].run, false);
  assert.equal(output.jobs['ios-maestro-release'].run, false);
});

test('ciImpact treats maestro changes as cross-platform mobile impact', () => {
  const output = runCiImpactWithArgs([
    '--files',
    'packages/client/.maestro/flows/smoke.yaml'
  ]);
  assert.equal(output.jobs.android.run, true);
  assert.equal(output.jobs['android-maestro-release'].run, true);
  assert.equal(output.jobs['ios-maestro-release'].run, true);
});

test('ciImpact treats shared mobile release config as cross-platform mobile impact', () => {
  const output = runCiImpactWithArgs([
    '--files',
    'packages/client/fastlane/Fastfile'
  ]);
  assert.equal(output.jobs.android.run, true);
  assert.equal(output.jobs['android-maestro-release'].run, true);
  assert.equal(output.jobs['ios-maestro-release'].run, true);
});
