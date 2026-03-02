/**
 * Key storage operations for Electron SQLite.
 * Handles salt, key check value, and session persistence using safeStorage.
 */

import { getErrorCode } from '@tearleads/shared';
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

const SALT_PREFIX = '.salt';
const KCV_PREFIX = '.kcv';
const PASSWORD_WRAPPED_KEY_PREFIX = '.password_wrapped_key';
const WRAPPING_KEY_PREFIX = '.wrapping_key';
const WRAPPED_KEY_PREFIX = '.wrapped_key';
const PLAINTEXT_FALLBACK_PREFIX = 'plain:';

function getStoragePath(filename: string): string {
  return path.join(app.getPath('userData'), filename);
}

function getSaltFilename(instanceId: string): string {
  return `${SALT_PREFIX}_${instanceId}`;
}

function getKcvFilename(instanceId: string): string {
  return `${KCV_PREFIX}_${instanceId}`;
}

function getWrappingKeyFilename(instanceId: string): string {
  return `${WRAPPING_KEY_PREFIX}_${instanceId}`;
}

function getPasswordWrappedKeyFilename(instanceId: string): string {
  return `${PASSWORD_WRAPPED_KEY_PREFIX}_${instanceId}`;
}

function getWrappedKeyFilename(instanceId: string): string {
  return `${WRAPPED_KEY_PREFIX}_${instanceId}`;
}

/**
 * Securely zero out a buffer to prevent key material from lingering in memory.
 */
export function secureZeroBuffer(buffer: Buffer): void {
  buffer.fill(0);
}

/**
 * Helper to store encrypted data using safeStorage.
 */
function storeEncryptedData(data: number[], filename: string): void {
  const keyPath = getStoragePath(filename);
  const buffer = Buffer.from(data);
  const base64 = buffer.toString('base64');
  secureZeroBuffer(buffer);

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(base64);
    fs.writeFileSync(keyPath, encrypted);
    return;
  }

  // Fallback for environments without safeStorage (e.g. CI Linux keyring).
  fs.writeFileSync(
    keyPath,
    `${PLAINTEXT_FALLBACK_PREFIX}${base64}`,
    'utf8'
  );
}

function decodePlaintextFallback(content: string): number[] | null {
  if (!content.startsWith(PLAINTEXT_FALLBACK_PREFIX)) {
    return null;
  }
  const base64 = content.slice(PLAINTEXT_FALLBACK_PREFIX.length);
  const buffer = Buffer.from(base64, 'base64');
  const result = Array.from(buffer);
  secureZeroBuffer(buffer);
  return result;
}

/**
 * Helper to retrieve encrypted data using safeStorage.
 */
function getEncryptedData(filename: string): number[] | null {
  const keyPath = getStoragePath(filename);
  try {
    const stored = fs.readFileSync(keyPath);

    if (safeStorage.isEncryptionAvailable()) {
      try {
        const decrypted = safeStorage.decryptString(stored);
        const buffer = Buffer.from(decrypted, 'base64');
        const result = Array.from(buffer);
        secureZeroBuffer(buffer);
        return result;
      } catch {
        // Fall back when data was previously persisted without safeStorage.
        return decodePlaintextFallback(stored.toString('utf8'));
      }
    }

    return decodePlaintextFallback(stored.toString('utf8'));
  } catch (error: unknown) {
    // It's normal for the file not to exist. Only log other errors.
    const code = getErrorCode(error);
    if (error instanceof Error && code !== 'ENOENT') {
      console.error(
        `Failed to read or decrypt session data from ${keyPath}:`,
        error
      );
    }
    return null;
  }
}

// Salt operations
export function storeSalt(salt: number[], instanceId: string): void {
  const saltPath = getStoragePath(getSaltFilename(instanceId));
  fs.writeFileSync(saltPath, JSON.stringify(salt), 'utf8');
}

export function getSalt(instanceId: string): number[] | null {
  const saltPath = getStoragePath(getSaltFilename(instanceId));
  try {
    return JSON.parse(fs.readFileSync(saltPath, 'utf8'));
  } catch {
    return null;
  }
}

// Key check value operations
export function storeKeyCheckValue(kcv: string, instanceId: string): void {
  const kcvPath = getStoragePath(getKcvFilename(instanceId));
  fs.writeFileSync(kcvPath, kcv, 'utf8');
}

export function getKeyCheckValue(instanceId: string): string | null {
  const kcvPath = getStoragePath(getKcvFilename(instanceId));
  try {
    return fs.readFileSync(kcvPath, 'utf8');
  } catch {
    return null;
  }
}

export function clearKeyStorage(instanceId: string): void {
  const saltPath = getStoragePath(getSaltFilename(instanceId));
  const kcvPath = getStoragePath(getKcvFilename(instanceId));
  const passwordWrappedKeyPath = getStoragePath(
    getPasswordWrappedKeyFilename(instanceId)
  );

  fs.rmSync(saltPath, { force: true });
  fs.rmSync(kcvPath, { force: true });
  fs.rmSync(passwordWrappedKeyPath, { force: true });
}

export function storePasswordWrappedKey(
  wrappedKey: number[],
  instanceId: string
): void {
  storeEncryptedData(wrappedKey, getPasswordWrappedKeyFilename(instanceId));
}

export function getPasswordWrappedKey(instanceId: string): number[] | null {
  return getEncryptedData(getPasswordWrappedKeyFilename(instanceId));
}

// Session persistence operations using safeStorage
export function storeWrappingKey(keyBytes: number[], instanceId: string): void {
  storeEncryptedData(keyBytes, getWrappingKeyFilename(instanceId));
}

export function getWrappingKey(instanceId: string): number[] | null {
  return getEncryptedData(getWrappingKeyFilename(instanceId));
}

export function storeWrappedKey(wrappedKey: number[], instanceId: string): void {
  storeEncryptedData(wrappedKey, getWrappedKeyFilename(instanceId));
}

export function getWrappedKey(instanceId: string): number[] | null {
  return getEncryptedData(getWrappedKeyFilename(instanceId));
}

export function hasSession(instanceId: string): boolean {
  const wrappingKeyPath = getStoragePath(getWrappingKeyFilename(instanceId));
  const wrappedKeyPath = getStoragePath(getWrappedKeyFilename(instanceId));
  return fs.existsSync(wrappingKeyPath) && fs.existsSync(wrappedKeyPath);
}

export function clearSession(instanceId: string): void {
  const wrappingKeyPath = getStoragePath(getWrappingKeyFilename(instanceId));
  const wrappedKeyPath = getStoragePath(getWrappedKeyFilename(instanceId));

  fs.rmSync(wrappingKeyPath, { force: true });
  fs.rmSync(wrappedKeyPath, { force: true });
}
