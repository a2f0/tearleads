import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

function baseImpactOutput(): string {
  return JSON.stringify({
    base: 'origin/main',
    head: 'HEAD',
    jobs: {
      build: { run: false, reasons: [] },
      'web-e2e': { run: false, reasons: [] },
      'website-e2e': { run: false, reasons: [] },
      'electron-e2e': { run: false, reasons: [] },
      android: { run: false, reasons: [] },
      'android-maestro-release': { run: false, reasons: [] },
      'ios-maestro-release': { run: false, reasons: [] }
    }
  });
}

function withStubPnpm(stubOutput: string): {
  tempDir: string;
  argsFile: string;
  pathValue: string;
} {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'required-workflows-stub-')
  );
  const argsFile = path.join(tempDir, 'pnpm-args.txt');
  const stubPath = path.join(tempDir, 'pnpm');
  const script = `#!/bin/sh
if [ -n "$STUB_ARGS_FILE" ]; then
  printf '%s\\n' "$@" > "$STUB_ARGS_FILE"
fi
cat <<'JSON'
${stubOutput}
JSON
`;

  fs.writeFileSync(stubPath, script, { encoding: 'utf8', mode: 0o755 });
  const pathValue = `${tempDir}:${process.env['PATH'] ?? ''}`;
  return { tempDir, argsFile, pathValue };
}

function runRequiredWorkflowsViaNode(
  args: string[],
  env: NodeJS.ProcessEnv
): ReturnType<typeof spawnSync> {
  return spawnSync(
    'node',
    ['--import', 'tsx', 'scripts/ciImpact/requiredWorkflows.ts', ...args],
    {
      encoding: 'utf8',
      env
    }
  );
}

function stderrText(result: ReturnType<typeof spawnSync>): string {
  return typeof result.stderr === 'string' ? result.stderr : '';
}

function runRequiredWorkflows(files: string[]): RequiredWorkflowsOutput {
  const output = execFileSync(
    'pnpm',
    [
      'exec',
      'tsx',
      'scripts/ciImpact/requiredWorkflows.ts',
      '--files',
      files.join(',')
    ],
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
  if (
    !Array.isArray(requiredWorkflowsRaw) ||
    !requiredWorkflowsRaw.every((value) => typeof value === 'string')
  ) {
    throw new Error(
      'requiredWorkflows output.requiredWorkflows must be a string[]'
    );
  }
  if (typeof reasonsRaw !== 'object' || reasonsRaw === null) {
    throw new Error('requiredWorkflows output.reasons must be an object');
  }
  const reasons: Record<string, string[]> = {};
  for (const key of Object.keys(reasonsRaw)) {
    const value = Reflect.get(reasonsRaw, key);
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === 'string')
    ) {
      throw new Error(
        `requiredWorkflows output.reasons.${key} must be a string[]`
      );
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
    name: 'deploy workflow-only change only requires build',
    files: ['.github/workflows/deploy-desktop.yml'],
    expectedWorkflows: ['build']
  },
  {
    name: 'API-only change',
    files: ['packages/api/src/index.ts'],
    expectedWorkflows: [
      'build',
      'Web E2E Tests (Release)',
      'Website E2E Tests (Release)'
    ]
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

test('required workflows uses default base/head when args are omitted', () => {
  const stub = withStubPnpm(baseImpactOutput());
  try {
    const result = runRequiredWorkflowsViaNode([], {
      ...process.env,
      PATH: stub.pathValue,
      STUB_ARGS_FILE: stub.argsFile
    });
    assert.equal(result.status, 0, stderrText(result));
    const argsLogged = fs.readFileSync(stub.argsFile, 'utf8');
    assert.ok(argsLogged.includes('--base\norigin/main'));
    assert.ok(argsLogged.includes('--head\nHEAD'));
  } finally {
    fs.rmSync(stub.tempDir, { recursive: true, force: true });
  }
});

test('required workflows ignores incomplete --base flag and keeps defaults', () => {
  const stub = withStubPnpm(baseImpactOutput());
  try {
    const result = runRequiredWorkflowsViaNode(['--base'], {
      ...process.env,
      PATH: stub.pathValue,
      STUB_ARGS_FILE: stub.argsFile
    });
    assert.equal(result.status, 0, stderrText(result));
    const argsLogged = fs.readFileSync(stub.argsFile, 'utf8');
    assert.ok(argsLogged.includes('--base\norigin/main'));
    assert.ok(argsLogged.includes('--head\nHEAD'));
  } finally {
    fs.rmSync(stub.tempDir, { recursive: true, force: true });
  }
});

test('required workflows fails when ciImpact output has non-boolean run value', () => {
  const invalidRunType = JSON.stringify({
    base: 'origin/main',
    head: 'HEAD',
    jobs: {
      build: { run: 'true', reasons: [] },
      'web-e2e': { run: false, reasons: [] },
      'website-e2e': { run: false, reasons: [] },
      'electron-e2e': { run: false, reasons: [] },
      android: { run: false, reasons: [] },
      'android-maestro-release': { run: false, reasons: [] },
      'ios-maestro-release': { run: false, reasons: [] }
    }
  });
  const stub = withStubPnpm(invalidRunType);
  try {
    const result = runRequiredWorkflowsViaNode([], {
      ...process.env,
      PATH: stub.pathValue,
      STUB_ARGS_FILE: stub.argsFile
    });
    assert.notEqual(result.status, 0);
    assert.ok(
      stderrText(result).includes('Invalid ciImpact output.jobs.build.run')
    );
  } finally {
    fs.rmSync(stub.tempDir, { recursive: true, force: true });
  }
});

test('required workflows fails when ciImpact output has invalid job object', () => {
  const invalidJobShape = JSON.stringify({
    base: 'origin/main',
    head: 'HEAD',
    jobs: {
      build: { run: false, reasons: [] },
      'web-e2e': null,
      'website-e2e': { run: false, reasons: [] },
      'electron-e2e': { run: false, reasons: [] },
      android: { run: false, reasons: [] },
      'android-maestro-release': { run: false, reasons: [] },
      'ios-maestro-release': { run: false, reasons: [] }
    }
  });
  const stub = withStubPnpm(invalidJobShape);
  try {
    const result = runRequiredWorkflowsViaNode([], {
      ...process.env,
      PATH: stub.pathValue,
      STUB_ARGS_FILE: stub.argsFile
    });
    assert.notEqual(result.status, 0);
    assert.ok(
      stderrText(result).includes('Invalid ciImpact output.jobs.web-e2e')
    );
  } finally {
    fs.rmSync(stub.tempDir, { recursive: true, force: true });
  }
});
