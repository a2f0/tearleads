/**
 * File-based key management for CLI.
 * Stores encryption keys and session data in ~/.tearleads
 */

import fs from 'node:fs/promises';
import {
  deriveKeyFromPassword,
  exportKey,
  exportWrappingKey,
  generateExtractableWrappingKey,
  generateSalt,
  importKey,
  importWrappingKey,
  secureZero,
  unwrapKey,
  wrapKey
} from '@rapid/shared';
import {
  clearSession as clearSessionFile,
  ensureConfigDir,
  getConfigPaths,
  hasSession as hasSessionFile
} from '../config/index.js';

export interface StoredKeyData {
  salt: number[];
  keyCheckValue: string;
}

export interface SessionData {
  wrappedKey: number[];
  wrappingKey: number[];
}

let currentKey: Uint8Array | null = null;

/**
 * Check if a database key has been set up.
 */
export async function hasExistingKey(): Promise<boolean> {
  const paths = getConfigPaths();
  try {
    await fs.access(paths.keyData);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read stored key data from file.
 */
async function readKeyData(): Promise<StoredKeyData | null> {
  const paths = getConfigPaths();
  try {
    const content = await fs.readFile(paths.keyData, 'utf-8');
    return JSON.parse(content) as StoredKeyData;
  } catch {
    return null;
  }
}

/**
 * Write key data to file with restrictive permissions.
 */
async function writeKeyData(data: StoredKeyData): Promise<void> {
  await ensureConfigDir();
  const paths = getConfigPaths();
  await fs.writeFile(paths.keyData, JSON.stringify(data), {
    mode: 0o600
  });
}

/**
 * Read session data from file.
 */
async function readSessionData(): Promise<SessionData | null> {
  const paths = getConfigPaths();
  try {
    const content = await fs.readFile(paths.session, 'utf-8');
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

/**
 * Write session data to file with restrictive permissions.
 */
async function writeSessionData(data: SessionData): Promise<void> {
  await ensureConfigDir();
  const paths = getConfigPaths();
  await fs.writeFile(paths.session, JSON.stringify(data), {
    mode: 0o600
  });
}

/**
 * Create a key check value for password verification.
 */
async function createKeyCheckValue(keyBytes: Uint8Array): Promise<string> {
  const checkData = new TextEncoder().encode('TEARLEADS_KEY_CHECK');
  const key = await importKey(keyBytes);

  const iv = new Uint8Array(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    checkData
  );

  const bytes = new Uint8Array(encrypted).slice(0, 16);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Set up a new encryption key from a password.
 */
export async function setupNewKey(password: string): Promise<Uint8Array> {
  const salt = generateSalt();
  const key = await deriveKeyFromPassword(password, salt);
  const keyBytes = await exportKey(key);

  const kcv = await createKeyCheckValue(keyBytes);

  await writeKeyData({
    salt: Array.from(salt),
    keyCheckValue: kcv
  });

  currentKey = new Uint8Array(keyBytes);
  return keyBytes;
}

/**
 * Unlock with a password. Returns null if password is incorrect.
 */
export async function unlockWithPassword(
  password: string
): Promise<Uint8Array | null> {
  const keyData = await readKeyData();
  if (!keyData) {
    throw new Error('No existing key found. Use setupNewKey instead.');
  }

  const salt = new Uint8Array(keyData.salt);
  const key = await deriveKeyFromPassword(password, salt);
  const keyBytes = await exportKey(key);

  const computedKcv = await createKeyCheckValue(keyBytes);

  if (keyData.keyCheckValue !== computedKcv) {
    secureZero(keyBytes);
    return null;
  }

  currentKey = new Uint8Array(keyBytes);
  return keyBytes;
}

/**
 * Change the encryption password.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<{ oldKey: Uint8Array; newKey: Uint8Array } | null> {
  const oldKeyResult = await unlockWithPassword(oldPassword);
  if (!oldKeyResult) return null;

  // Clone the old key before we change currentKey
  const oldKey = new Uint8Array(oldKeyResult);

  const newSalt = generateSalt();
  const newCryptoKey = await deriveKeyFromPassword(newPassword, newSalt);
  const newKey = await exportKey(newCryptoKey);
  const newKcv = await createKeyCheckValue(newKey);

  await writeKeyData({
    salt: Array.from(newSalt),
    keyCheckValue: newKcv
  });

  currentKey = new Uint8Array(newKey);

  return { oldKey, newKey };
}

/**
 * Get the current key (must be unlocked first).
 */
export function getCurrentKey(): Uint8Array | null {
  return currentKey;
}

/**
 * Clear the current key from memory.
 */
export function clearKey(): void {
  if (currentKey) {
    secureZero(currentKey);
    currentKey = null;
  }
}

/**
 * Reset everything (for testing or complete wipe).
 */
export async function reset(): Promise<void> {
  clearKey();
  const paths = getConfigPaths();
  try {
    await fs.unlink(paths.keyData);
  } catch {
    // Ignore
  }
  await clearSessionFile();
}

/**
 * Persist the current key for session restoration.
 */
export async function persistSession(): Promise<boolean> {
  if (!currentKey) return false;

  try {
    const wrappingKey = await generateExtractableWrappingKey();
    const wrappedKey = await wrapKey(currentKey, wrappingKey);
    const wrappingKeyBytes = await exportWrappingKey(wrappingKey);

    await writeSessionData({
      wrappedKey: Array.from(wrappedKey),
      wrappingKey: Array.from(wrappingKeyBytes)
    });

    return true;
  } catch (err) {
    console.error('Failed to persist session:', err);
    return false;
  }
}

/**
 * Check if a persisted session exists.
 */
export async function hasPersistedSession(): Promise<boolean> {
  return hasSessionFile();
}

/**
 * Restore a persisted session.
 */
export async function restoreSession(): Promise<Uint8Array | null> {
  try {
    const sessionData = await readSessionData();
    if (!sessionData) return null;

    const wrappingKeyBytes = new Uint8Array(sessionData.wrappingKey);
    const wrappedKey = new Uint8Array(sessionData.wrappedKey);

    const wrappingKey = await importWrappingKey(wrappingKeyBytes);
    const keyBytes = await unwrapKey(wrappedKey, wrappingKey);

    currentKey = new Uint8Array(keyBytes);
    return keyBytes;
  } catch (err) {
    console.error('Failed to restore session:', err);
    await clearPersistedSession();
    return null;
  }
}

/**
 * Clear any persisted session data.
 */
export async function clearPersistedSession(): Promise<void> {
  await clearSessionFile();
}
