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
const WRAPPING_KEY_PREFIX = '.wrapping_key';
const WRAPPED_KEY_PREFIX = '.wrapped_key';

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
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system');
  }
  const keyPath = getStoragePath(filename);
  const buffer = Buffer.from(data);
  const encrypted = safeStorage.encryptString(buffer.toString('base64'));
  secureZeroBuffer(buffer);
  fs.writeFileSync(keyPath, encrypted);
}

/**
 * Helper to retrieve encrypted data using safeStorage.
 */
function getEncryptedData(filename: string): number[] | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }
  const keyPath = getStoragePath(filename);
  try {
    const encrypted = fs.readFileSync(keyPath);
    const decrypted = safeStorage.decryptString(encrypted);
    const buffer = Buffer.from(decrypted, 'base64');
    const result = Array.from(buffer);
    secureZeroBuffer(buffer);
    return result;
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

  fs.rmSync(saltPath, { force: true });
  fs.rmSync(kcvPath, { force: true });
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
