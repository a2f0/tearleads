import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDefaultAuthProvider } from './authProvider.ts';

function writeExecutableScript(dir: string, name: string, body: string): void {
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

function withPatchedEnv<T>(mutate: () => T): T {
  const originalPath = process.env['PATH'];
  const originalGitHubToken = process.env['GITHUB_TOKEN'];
  const originalGhToken = process.env['GH_TOKEN'];

  try {
    return mutate();
  } finally {
    if (originalPath === undefined) {
      delete process.env['PATH'];
    } else {
      process.env['PATH'] = originalPath;
    }
    if (originalGitHubToken === undefined) {
      delete process.env['GITHUB_TOKEN'];
    } else {
      process.env['GITHUB_TOKEN'] = originalGitHubToken;
    }
    if (originalGhToken === undefined) {
      delete process.env['GH_TOKEN'];
    } else {
      process.env['GH_TOKEN'] = originalGhToken;
    }
  }
}

test('auth provider uses env token before gh token', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-auth-'));
  try {
    writeExecutableScript(
      tempDir,
      'gh',
      `#!/bin/sh
echo "gh-token-value"
`
    );

    withPatchedEnv(() => {
      process.env['PATH'] = `${tempDir}:${process.env['PATH'] ?? ''}`;
      process.env['GITHUB_TOKEN'] = 'env-token-value';
      delete process.env['GH_TOKEN'];

      const provider = createDefaultAuthProvider();
      assert.equal(provider.getGitHubToken(), 'env-token-value');
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('auth provider falls back to gh auth token', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-auth-'));
  try {
    writeExecutableScript(
      tempDir,
      'gh',
      `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "token" ]; then
  echo "gh-token-value"
  exit 0
fi
exit 1
`
    );

    withPatchedEnv(() => {
      process.env['PATH'] = `${tempDir}:${process.env['PATH'] ?? ''}`;
      delete process.env['GITHUB_TOKEN'];
      delete process.env['GH_TOKEN'];

      const provider = createDefaultAuthProvider();
      assert.equal(provider.getGitHubToken(), 'gh-token-value');
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
