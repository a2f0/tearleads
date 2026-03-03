import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT_PATH = 'scripts/checkAndroidKeystoreIntegrity.ts';

function runIntegrityCheck(
  args: string[],
  envOverrides: Record<string, string>
): ReturnType<typeof spawnSync> {
  return spawnSync('pnpm', ['exec', 'tsx', SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...envOverrides
    }
  });
}

function stdoutText(result: ReturnType<typeof spawnSync>): string {
  return typeof result.stdout === 'string' ? result.stdout : '';
}

function stderrText(result: ReturnType<typeof spawnSync>): string {
  return typeof result.stderr === 'string' ? result.stderr : '';
}

function createFakeKeytool(tempDir: string): string {
  const fakeBinDir = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBinDir);
  const scriptPath = path.join(fakeBinDir, 'keytool');

  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env sh
set -eu
if [ "\${FAKE_KEYTOOL_LOG:-}" != "" ]; then
  printf '%s\\n' "$*" >> "\${FAKE_KEYTOOL_LOG}"
fi
if [ "\${FAKE_KEYTOOL_MODE:-ok}" = "fail" ]; then
  echo "simulated keytool failure" >&2
  exit 1
fi
exit 0
`,
    { mode: 0o755 }
  );

  return fakeBinDir;
}

test('fails when source argument is missing', () => {
  const result = runIntegrityCheck([], {});

  assert.equal(result.status, 1);
  assert.match(stderrText(result), /--source is required\./);
});

test('fails with dependabot hint when base64 env is empty', () => {
  const result = runIntegrityCheck(
    [
      '--source',
      'env',
      '--base64-env',
      'TEST_KEYSTORE',
      '--store-pass-env',
      'TEST_STORE_PASS',
      '--key-pass-env',
      'TEST_KEY_PASS'
    ],
    {
      TEST_KEYSTORE: '',
      TEST_STORE_PASS: 'store-pass',
      TEST_KEY_PASS: 'key-pass'
    }
  );

  assert.equal(result.status, 1);
  assert.match(stderrText(result), /Dependabot-triggered workflow/);
  assert.match(stderrText(result), /TEST_KEYSTORE is empty/);
});

test('fails when a flag value is omitted', () => {
  const result = runIntegrityCheck(
    [
      '--source',
      'env',
      '--base64-env',
      '--store-pass-env',
      'TEST_STORE_PASS',
      '--key-pass-env',
      'TEST_KEY_PASS'
    ],
    {
      TEST_STORE_PASS: 'store-pass',
      TEST_KEY_PASS: 'key-pass'
    }
  );

  assert.equal(result.status, 1);
  assert.match(stderrText(result), /Missing value for --base64-env/);
});

test('env validation trims alias from env and validates successfully', (t) => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'android-keystore-integrity-env-')
  );
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const logPath = path.join(tempDir, 'keytool.log');
  const fakeBinDir = createFakeKeytool(tempDir);
  const pathEnv = process.env['PATH'] ?? '';
  const result = runIntegrityCheck(
    [
      '--source',
      'env',
      '--base64-env',
      'TEST_KEYSTORE',
      '--store-pass-env',
      'TEST_STORE_PASS',
      '--key-pass-env',
      'TEST_KEY_PASS',
      '--key-alias-env',
      'TEST_KEY_ALIAS',
      '--key-alias',
      'fallback-alias',
      '--context',
      'env validation test'
    ],
    {
      PATH: `${fakeBinDir}:${pathEnv}`,
      FAKE_KEYTOOL_LOG: logPath,
      TEST_KEYSTORE: 'YQ==\n',
      TEST_STORE_PASS: 'store-pass',
      TEST_KEY_PASS: 'key-pass',
      TEST_KEY_ALIAS: ' custom-alias '
    }
  );

  assert.equal(
    result.status,
    0,
    `${stdoutText(result)}\n${stderrText(result)}`
  );
  assert.match(stdoutText(result), /alias 'custom-alias'/);

  const invocations = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(invocations.length, 1);
  const firstInvocation = invocations[0];
  assert.ok(firstInvocation);
  assert.match(firstInvocation, /-alias custom-alias/);
});

test('invalid base64 fails before keytool invocation', (t) => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'android-keystore-integrity-base64-')
  );
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const logPath = path.join(tempDir, 'keytool.log');
  const fakeBinDir = createFakeKeytool(tempDir);
  const pathEnv = process.env['PATH'] ?? '';
  const result = runIntegrityCheck(
    [
      '--source',
      'env',
      '--base64-env',
      'TEST_KEYSTORE',
      '--store-pass-env',
      'TEST_STORE_PASS',
      '--key-pass-env',
      'TEST_KEY_PASS'
    ],
    {
      PATH: `${fakeBinDir}:${pathEnv}`,
      FAKE_KEYTOOL_LOG: logPath,
      TEST_KEYSTORE: 'not-base64',
      TEST_STORE_PASS: 'store-pass',
      TEST_KEY_PASS: 'key-pass'
    }
  );

  assert.equal(result.status, 1);
  assert.match(stderrText(result), /invalid base64 payload/);
  assert.equal(fs.existsSync(logPath), false);
});

test('file validation performs base64 round-trip validation', (t) => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'android-keystore-integrity-file-')
  );
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const keystoreFile = path.join(tempDir, 'keystore.p12');
  fs.writeFileSync(keystoreFile, Buffer.from('test keystore payload'));

  const logPath = path.join(tempDir, 'keytool.log');
  const fakeBinDir = createFakeKeytool(tempDir);
  const pathEnv = process.env['PATH'] ?? '';
  const result = runIntegrityCheck(
    [
      '--source',
      'file',
      '--file',
      keystoreFile,
      '--store-pass-env',
      'TEST_STORE_PASS',
      '--key-pass-env',
      'TEST_KEY_PASS',
      '--key-alias',
      'tearleads'
    ],
    {
      PATH: `${fakeBinDir}:${pathEnv}`,
      FAKE_KEYTOOL_LOG: logPath,
      TEST_STORE_PASS: 'store-pass',
      TEST_KEY_PASS: 'key-pass'
    }
  );

  assert.equal(
    result.status,
    0,
    `${stdoutText(result)}\n${stderrText(result)}`
  );
  const invocations = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(invocations.length, 2);
});
