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
