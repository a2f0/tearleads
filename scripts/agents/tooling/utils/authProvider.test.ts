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
  const originalXdgConfigHome = process.env['XDG_CONFIG_HOME'];
  const originalGhConfigDir = process.env['GH_CONFIG_DIR'];
  const originalGitHubHost = process.env['GITHUB_HOST'];

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
    if (originalXdgConfigHome === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = originalXdgConfigHome;
    }
    if (originalGhConfigDir === undefined) {
      delete process.env['GH_CONFIG_DIR'];
    } else {
      process.env['GH_CONFIG_DIR'] = originalGhConfigDir;
    }
    if (originalGitHubHost === undefined) {
      delete process.env['GITHUB_HOST'];
    } else {
      process.env['GITHUB_HOST'] = originalGitHubHost;
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

test('auth provider falls back to gh config hosts.yml when gh auth token fails', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-auth-'));
  const configDir = path.join(tempDir, 'config');
  const ghDir = path.join(configDir, 'gh');
  try {
    writeExecutableScript(
      tempDir,
      'gh',
      `#!/bin/sh
exit 1
`
    );

    fs.mkdirSync(ghDir, { recursive: true });
    fs.writeFileSync(
      path.join(ghDir, 'hosts.yml'),
      `evil.corp:
    oauth_token: wrong-token
github.com:
    oauth_token: config-token-value
    user: testuser
    git_protocol: ssh
another.host.com:
    oauth_token: also-wrong-token
    user: someotheruser
`
    );

    withPatchedEnv(() => {
      process.env['PATH'] = `${tempDir}:${process.env['PATH'] ?? ''}`;
      delete process.env['GITHUB_TOKEN'];
      delete process.env['GH_TOKEN'];
      process.env['XDG_CONFIG_HOME'] = configDir;

      const provider = createDefaultAuthProvider();
      assert.equal(provider.getGitHubToken(), 'config-token-value');
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('auth provider reads quoted token from GH_CONFIG_DIR hosts.yml', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttool-auth-'));
  const ghConfigDir = path.join(tempDir, 'ghconfig');
  const ghDir = path.join(ghConfigDir, 'gh');
  try {
    writeExecutableScript(
      tempDir,
      'gh',
      `#!/bin/sh
exit 1
`
    );

    fs.mkdirSync(ghDir, { recursive: true });
    fs.writeFileSync(
      path.join(ghDir, 'hosts.yml'),
      `"github.example.com":
    oauth_token: "quoted-token-value"
`
    );

    withPatchedEnv(() => {
      process.env['PATH'] = `${tempDir}:${process.env['PATH'] ?? ''}`;
      delete process.env['GITHUB_TOKEN'];
      delete process.env['GH_TOKEN'];
      process.env['GH_CONFIG_DIR'] = ghConfigDir;
      process.env['GITHUB_HOST'] = 'github.example.com';

      const provider = createDefaultAuthProvider();
      assert.equal(provider.getGitHubToken(), 'quoted-token-value');
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
