import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

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

function createTempBin(t: TestContext, prefix: string): { binDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);
  return { binDir };
}

test('checkGeminiQuota detects quota message across review surfaces', (t) => {
  const { binDir } = createTempBin(t, 'agenttool-quota-');
  const pathEnv = process.env['PATH'] ?? '';

  createCustomScript(
    binDir,
    'gh',
    `#!/bin/sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/a2f0/tearleads/pulls/42/comments" ]; then
  echo "Normal review note"
  echo "You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/a2f0/tearleads/issues/42/comments" ]; then
  echo "Issue comment"
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  const result = runAgentTool(['checkGeminiQuota', '--number', '42'], {
    PATH: `${binDir}:${pathEnv}`
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.status, 'success');
  assert.equal(parsed.quota_exhausted, true);
  assert.equal(parsed.match_count, 1);
});

test('listDeferredFixIssues returns deferred-fix issues', (t) => {
  const { binDir } = createTempBin(t, 'agenttool-dfix-');
  const ghLogPath = path.join(path.dirname(binDir), 'gh.log');
  const pathEnv = process.env['PATH'] ?? '';

  createCustomScript(
    binDir,
    'gh',
    `#!/bin/sh
echo "$@" >> "${ghLogPath}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  echo '[{"number":12,"title":"chore: deferred fixes from PR #123","url":"https://example.com/issues/12","state":"OPEN"}]'
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  const result = runAgentTool(
    ['listDeferredFixIssues', '--state', 'open', '--limit', '5'],
    {
      PATH: `${binDir}:${pathEnv}`
    }
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed[0].number, 12);

  const ghLog = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghLog, /^issue list/m);
  assert.match(ghLog, /--label deferred-fix/);
  assert.match(ghLog, /--limit 5/);
});

test('getIssue fetches issue details by number', (t) => {
  const { binDir } = createTempBin(t, 'agenttool-issue-');
  const ghLogPath = path.join(path.dirname(binDir), 'gh.log');
  const pathEnv = process.env['PATH'] ?? '';

  createCustomScript(
    binDir,
    'gh',
    `#!/bin/sh
echo "$@" >> "${ghLogPath}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "a2f0/tearleads"
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  echo '{"number":27,"title":"Deferred fix issue","body":"Body","url":"https://example.com/issues/27","state":"OPEN","labels":[]}'
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`
  );

  const result = runAgentTool(['getIssue', '--number', '27'], {
    PATH: `${binDir}:${pathEnv}`
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(readStdout(result));
  assert.equal(parsed.number, 27);
  assert.equal(parsed.title, 'Deferred fix issue');

  const ghLog = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghLog, /^issue view 27/m);
});
