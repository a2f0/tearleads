import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const TOOL_PATH = 'scripts/agents/tooling/agentTool.ts';

function runAgentTool(
  args: string[],
  envOverrides: Record<string, string> = {}
): ReturnType<typeof spawnSync> {
  return spawnSync('pnpm', ['exec', 'tsx', TOOL_PATH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...envOverrides
    }
  });
}

function readStdout(result: ReturnType<typeof spawnSync>): string {
  const stdout = result.stdout;
  if (typeof stdout !== 'string') {
    throw new Error('Expected string stdout');
  }
  return stdout;
}

function createCustomScript(
  dir: string,
  name: string,
  content: string,
  mode = 0o755
): void {
  fs.writeFileSync(path.join(dir, name), content, { mode });
}

test('createIssue deferred-fix requires --source-pr', () => {
  const result = runAgentTool([
    'createIssue',
    '--type',
    'deferred-fix',
    '--title',
    'chore: deferred fix from PR #123'
  ]);

  assert.equal(result.status, 1);
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(
    combinedOutput,
    /createIssue --type deferred-fix requires --source-pr/
  );
});

test('verifyBranchPush reports synced branch heads', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-sync-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const fakeBinDir = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBinDir);
  const pathEnv = process.env['PATH'] ?? '';

  createCustomScript(
    fakeBinDir,
    'gh',
    `#!/bin/sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  createCustomScript(
    fakeBinDir,
    'git',
    `#!/bin/sh
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  echo "feature/test"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  pwd
  exit 0
fi
if [ "$1" = "fetch" ] && [ "$2" = "origin" ]; then
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  echo "abc1234"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "origin/feature/test" ]; then
  echo "abc1234"
  exit 0
fi
echo "unexpected git invocation: $@" >&2
exit 1
`
  );

  const result = runAgentTool(['verifyBranchPush'], {
    PATH: `${fakeBinDir}:${pathEnv}`
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'synced');
  assert.equal(parsed.synced, true);
  assert.equal(parsed.branch, 'feature/test');
});

test('getGitContext returns branch and head sha', () => {
  const result = runAgentTool(['getGitContext']);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(typeof parsed.branch, 'string');
  assert.equal(typeof parsed.head_sha, 'string');
  assert.ok(parsed.branch.length > 0);
  assert.match(parsed.head_sha, /^[0-9a-f]{40}$/);
});

test('runTerraformStackScript requires --yes unless dry-run', () => {
  const result = runAgentTool([
    'runTerraformStackScript',
    '--stack',
    'staging/k8s',
    '--script',
    'apply01'
  ]);

  assert.equal(result.status, 1);
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(
    combinedOutput,
    /runTerraformStackScript requires --yes unless --dry-run is set/
  );
});

test('runAnsibleBootstrap requires --yes unless dry-run', () => {
  const result = runAgentTool([
    'runAnsibleBootstrap',
    '--target',
    'staging-k8s'
  ]);

  assert.equal(result.status, 1);
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(
    combinedOutput,
    /runAnsibleBootstrap requires --yes unless --dry-run is set/
  );
});

test('runTerraformStackScript dry-run succeeds without --yes', () => {
  const result = runAgentTool([
    'runTerraformStackScript',
    '--stack',
    'staging/k8s',
    '--script',
    'apply01',
    '--dry-run'
  ]);

  assert.equal(result.status, 0);
  assert.match(
    readStdout(result),
    /dry-run: would run inline action runTerraformStackScript/
  );
});
