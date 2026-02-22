import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function runReadiness(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): ReturnType<typeof spawnSync> {
  return spawnSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/qa/vfsSecureUploadReadiness.ts', ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env
      }
    }
  );
}

function readOutput(value: string | NodeJS.ArrayBufferView | null): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null) {
    return '';
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString(
    'utf8'
  );
}

test('dry-run writes readiness reports with skipped checks', (t) => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'vfs-secure-upload-qa-')
  );
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const jsonPath = path.join(tempDir, 'readiness.json');
  const markdownPath = path.join(tempDir, 'readiness.md');
  const candidateSha = 'test-sha-123';

  const result = runReadiness(
    ['--dry-run', '--report-json', jsonPath, '--report-markdown', markdownPath],
    { GITHUB_SHA: candidateSha }
  );

  assert.equal(result.status, 0, readOutput(result.stderr));
  assert.match(readOutput(result.stdout), /Dry run: yes/);

  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
    candidateSha: string;
    dryRun: boolean;
    failed: number;
    skipped: number;
    checksRun: number;
    checks: Array<{ status: string }>;
  };

  assert.equal(parsed.candidateSha, candidateSha);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.failed, 0);
  assert.equal(parsed.checksRun, 4);
  assert.equal(parsed.skipped, 4);
  for (const check of parsed.checks) {
    assert.equal(check.status, 'skipped');
  }

  const markdown = fs.readFileSync(markdownPath, 'utf8');
  assert.match(markdown, /# VFS Secure Upload Readiness Report/);
  assert.match(markdown, /\| `api-rekey-crdt` \| SKIP \|/);
  assert.match(markdown, /## Sign-off Fields/);
});
