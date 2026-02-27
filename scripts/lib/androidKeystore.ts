import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface AndroidKeystoreCredentials {
  keyAlias: string;
  keyPassword: string;
  storePassword: string;
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function readEnvValueFromFile(
  filePath: string,
  key: string
): string | undefined {
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const withoutExport = line.startsWith('export ')
      ? line.slice('export '.length)
      : line;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const parsedKey = withoutExport.slice(0, eqIndex).trim();
    if (parsedKey !== key) {
      continue;
    }

    const rawValue = withoutExport.slice(eqIndex + 1).trim();
    return stripOuterQuotes(rawValue);
  }

  return undefined;
}

export function validateAndroidKeystore(
  filePath: string,
  credentials: AndroidKeystoreCredentials,
  context: string
): void {
  const result = spawnSync(
    'keytool',
    [
      '-list',
      '-keystore',
      filePath,
      '-storepass',
      credentials.storePassword,
      '-alias',
      credentials.keyAlias,
      '-keypass',
      credentials.keyPassword
    ],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }
  );

  if (result.error) {
    throw new Error(
      `${context} failed: keytool is unavailable (${result.error.message}).`
    );
  }

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const lastLine = stderr.split('\n').at(-1)?.trim() ?? '';
    const detail =
      lastLine.length > 0
        ? lastLine
        : `keytool exited with status ${result.status}`;
    throw new Error(
      `${context} failed: keytool could not read alias '${credentials.keyAlias}' from keystore (${detail}).`
    );
  }
}

export function validateAndroidKeystoreBase64(
  base64Content: string,
  credentials: AndroidKeystoreCredentials,
  context: string
): void {
  const normalized = base64Content.replace(/\s+/g, '');
  if (normalized.length === 0 || normalized.length % 4 !== 0) {
    throw new Error(`${context} failed: invalid base64 payload.`);
  }

  const decoded = Buffer.from(normalized, 'base64');
  const reencoded = decoded.toString('base64');
  if (reencoded !== normalized) {
    throw new Error(`${context} failed: invalid base64 payload.`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'tearleads-keystore-'));
  const tempPath = join(tempDir, 'keystore.p12');
  try {
    writeFileSync(tempPath, decoded);
    validateAndroidKeystore(tempPath, credentials, context);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // best-effort cleanup
    }
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // best-effort cleanup
    }
  }
}
