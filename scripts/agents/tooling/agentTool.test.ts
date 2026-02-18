import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

const TOOL_PATH = 'scripts/agents/tooling/agentTool.ts';

function createFakeGhScript(dir: string): string {
  const logPath = path.join(dir, 'gh.log');
  const scriptPath = path.join(dir, 'gh');
  const script = `#!/bin/sh
echo "$@" >> "${logPath}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  echo '{"number":321,"title":"Existing issue","url":"https://example.com/issues/321"}'
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  echo "https://example.com/issues/322"
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return logPath;
}

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

function createTempBin(t: TestContext): {
  fakeBinDir: string;
  logPath: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-test-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const fakeBinDir = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBinDir);
  const logPath = createFakeGhScript(fakeBinDir);
  return { fakeBinDir, logPath };
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

test('createIssue returns existing issue when dedupe finds a match', (t) => {
  const { fakeBinDir, logPath } = createTempBin(t);

  const pathEnv = process.env['PATH'] ?? '';
  const result = runAgentTool(
    [
      'createIssue',
      '--type',
      'user-requested',
      '--title',
      'feat: improve repo id lookup',
      '--search',
      'repo id lookup'
    ],
    { PATH: `${fakeBinDir}:${pathEnv}` }
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'existing');
  assert.equal(parsed.issue.number, 321);

  const log = fs.readFileSync(logPath, 'utf8');
  assert.match(log, /^repo view/m);
  assert.match(log, /^issue list/m);
  assert.doesNotMatch(log, /^issue create/m);
});

test('createIssue creates new issue when --force is set', (t) => {
  const { fakeBinDir, logPath } = createTempBin(t);

  const pathEnv = process.env['PATH'] ?? '';
  const result = runAgentTool(
    [
      'createIssue',
      '--type',
      'user-requested',
      '--title',
      'feat: improve repo id lookup',
      '--force'
    ],
    { PATH: `${fakeBinDir}:${pathEnv}` }
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'created');
  assert.equal(parsed.issue_url, 'https://example.com/issues/322');

  const log = fs.readFileSync(logPath, 'utf8');
  assert.match(log, /^repo view/m);
  assert.match(log, /^issue create/m);
  assert.doesNotMatch(log, /^issue list/m);
});

test('checkMainVersionBumpSetup reports missing requirements', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-setup-'));
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
if [ "$1" = "secret" ] && [ "$2" = "list" ]; then
  echo "MERGE_SIGNING_APP_ID\t2026-02-18T00:00:00Z"
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  const result = runAgentTool(
    [
      'checkMainVersionBumpSetup',
      '--key-file',
      path.join(tempDir, 'missing.pem')
    ],
    {
      PATH: `${fakeBinDir}:${pathEnv}`,
      TF_VAR_merge_signing_app_id: '',
      TF_VAR_merge_signing_app_installation_id: ''
    }
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'missing_requirements');
  assert.match(
    JSON.stringify(parsed.missing),
    /TF_VAR_merge_signing_app_installation_id is not set/
  );
  assert.match(
    JSON.stringify(parsed.missing),
    /MERGE_SIGNING_APP_PRIVATE_KEY not found in repo secrets/
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

test('sanitizePrBody strips auto-close directives and updates PR', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-body-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const fakeBinDir = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBinDir);
  const ghLogPath = path.join(tempDir, 'gh.log');
  const pathEnv = process.env['PATH'] ?? '';

  createCustomScript(
    fakeBinDir,
    'gh',
    `#!/bin/sh
echo "$@" >> "${ghLogPath}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo "## Summary
- Change here

Fixes #123
Resolves #456"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  const result = runAgentTool(['sanitizePrBody', '--number', '99'], {
    PATH: `${fakeBinDir}:${pathEnv}`
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'updated');
  assert.deepEqual(parsed.issue_numbers, [123, 456]);
  assert.doesNotMatch(parsed.body, /Fixes|Resolves/i);

  const ghLog = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghLog, /^pr view 99/m);
  assert.match(ghLog, /^pr edit 99/m);
});

test('createDeferredFixIssue creates issue from deferred items JSON', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-def-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const fakeBinDir = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBinDir);
  const ghLogPath = path.join(tempDir, 'gh.log');
  const pathEnv = process.env['PATH'] ?? '';

  createCustomScript(
    fakeBinDir,
    'gh',
    `#!/bin/sh
echo "$@" >> "${ghLogPath}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  echo "https://example.com/issues/987"
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  const deferredItems = JSON.stringify([
    {
      body: 'Address race condition',
      path: 'src/queue.ts',
      line: 88,
      html_url: 'https://github.com/example/repo/pull/1#discussion_r1'
    }
  ]);

  const result = runAgentTool(
    [
      'createDeferredFixIssue',
      '--number',
      '77',
      '--pr-url',
      'https://github.com/example/repo/pull/77',
      '--deferred-items-json',
      deferredItems
    ],
    { PATH: `${fakeBinDir}:${pathEnv}` }
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'created');
  assert.equal(parsed.source_pr, 77);
  assert.equal(parsed.deferred_item_count, 1);
  assert.equal(parsed.issue_url, 'https://example.com/issues/987');

  const ghLog = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghLog, /^issue create/m);
  assert.match(ghLog, /deferred-fix/);
});

test('updatePrBody updates PR body from file', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-prbody-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const fakeBinDir = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBinDir);
  const ghLogPath = path.join(tempDir, 'gh.log');
  const bodyFile = path.join(tempDir, 'body.md');
  const pathEnv = process.env['PATH'] ?? '';
  fs.writeFileSync(bodyFile, '## Summary\n- Updated by test\n');

  createCustomScript(
    fakeBinDir,
    'gh',
    `#!/bin/sh
echo "$@" >> "${ghLogPath}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  const result = runAgentTool(
    ['updatePrBody', '--number', '44', '--body-file', bodyFile],
    { PATH: `${fakeBinDir}:${pathEnv}` }
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'updated');
  assert.equal(parsed.pr, 44);

  const ghLog = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghLog, /^pr edit 44/m);
});
