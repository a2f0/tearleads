import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { ALL_JOB_NAMES, type JobName } from './workflowConfig.js';

interface JobState {
  run: boolean;
  reasons: string[];
}

interface CiImpactOutput {
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

function runCiImpact(files: string[]): CiImpactOutput {
  const output = execFileSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/ciImpact/ciImpact.ts', '--files', files.join(',')],
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
    output.warnings.includes('All file changes are ignored by trigger policy (docs/config-only).'),
    'docs-only change should explain why jobs were skipped'
  );
});
