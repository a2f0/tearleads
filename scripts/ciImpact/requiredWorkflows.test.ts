import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

interface RequiredWorkflowsOutput {
  requiredWorkflows: string[];
  reasons: Record<string, string[]>;
}

interface Scenario {
  name: string;
  files: string[];
  expectedWorkflows: string[];
}

function runRequiredWorkflows(files: string[]): RequiredWorkflowsOutput {
  const output = execFileSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/ciImpact/requiredWorkflows.ts', '--files', files.join(',')],
    {
      encoding: 'utf8'
    }
  );

  const parsed = JSON.parse(output);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('requiredWorkflows output must be a JSON object');
  }
  const requiredWorkflowsRaw = Reflect.get(parsed, 'requiredWorkflows');
  const reasonsRaw = Reflect.get(parsed, 'reasons');
  if (!Array.isArray(requiredWorkflowsRaw) || !requiredWorkflowsRaw.every((value) => typeof value === 'string')) {
    throw new Error('requiredWorkflows output.requiredWorkflows must be a string[]');
  }
  if (typeof reasonsRaw !== 'object' || reasonsRaw === null) {
    throw new Error('requiredWorkflows output.reasons must be an object');
  }
  const reasons: Record<string, string[]> = {};
  for (const key of Object.keys(reasonsRaw)) {
    const value = Reflect.get(reasonsRaw, key);
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error(`requiredWorkflows output.reasons.${key} must be a string[]`);
    }
    reasons[key] = value;
  }
  return {
    requiredWorkflows: requiredWorkflowsRaw,
    reasons
  };
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    name: 'docs-only change',
    files: ['docs/en/ci.md'],
    expectedWorkflows: []
  },
  {
    name: 'workflow change triggers full matrix',
    files: ['.github/workflows/build.yml'],
    expectedWorkflows: [
      'build',
      'Web E2E Tests (Release)',
      'Website E2E Tests (Release)',
      'Electron E2E Tests (Release)',
      'Android Instrumented Tests',
      'Android Maestro Tests (Release)',
      'iOS Maestro Tests (Release)'
    ]
  },
  {
    name: 'API-only change',
    files: ['packages/api/src/index.ts'],
    expectedWorkflows: ['build', 'Web E2E Tests (Release)', 'Website E2E Tests (Release)']
  },
  {
    name: 'website-only change',
    files: ['packages/website/src/index.ts'],
    expectedWorkflows: ['build', 'Website E2E Tests (Release)']
  },
  {
    name: 'android-only native change',
    files: ['packages/client/android/app/src/main/AndroidManifest.xml'],
    expectedWorkflows: [
      'build',
      'Web E2E Tests (Release)',
      'Electron E2E Tests (Release)',
      'Android Instrumented Tests',
      'Android Maestro Tests (Release)'
    ]
  },
  {
    name: 'ios-only native change',
    files: ['packages/client/ios/App/AppDelegate.swift'],
    expectedWorkflows: [
      'build',
      'Web E2E Tests (Release)',
      'Electron E2E Tests (Release)',
      'iOS Maestro Tests (Release)'
    ]
  }
];

for (const scenario of scenarios) {
  test(`required workflows: ${scenario.name}`, () => {
    const output = runRequiredWorkflows(scenario.files);

    assert.deepEqual(
      sortStrings(output.requiredWorkflows),
      sortStrings(scenario.expectedWorkflows),
      `${scenario.name}: required workflow set mismatch`
    );

    assert.deepEqual(
      sortStrings(Object.keys(output.reasons)),
      sortStrings(output.requiredWorkflows),
      `${scenario.name}: reasons keys must match required workflows`
    );
  });
}

test('required workflows: docs-only change has empty reasons', () => {
  const output = runRequiredWorkflows(['docs/en/ci.md']);
  assert.deepEqual(output.reasons, {});
});
