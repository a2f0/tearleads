/**
 * Key management for database encryption.
 * Handles key derivation and secure storage per platform.
 * Supports multi-instance with namespaced storage keys.
 */

import {
  deriveKeyFromPassword,
  exportKey,
  generateExtractableWrappingKey,
  generateSalt,
  generateWrappingKey,
  importKey,
  secureZero,
  unwrapKey,
  wrapKey
} from '@tearleads/shared';
import { detectPlatform } from '@/lib/utils';
import {
  getStorageAdapter,
  type KeyStorageAdapter
} from './keyManagerStorageAdapters';
import * as nativeSecureStorage from './nativeSecureStorage';

/**
 * Key manager class for handling encryption key lifecycle.
 * Each instance has its own isolated key storage.
 */
export class KeyManager {
  private storage: KeyStorageAdapter | null = null;
  private currentKey: Uint8Array | null = null;
  private instanceId: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  /**
   * Get the instance ID this key manager is associated with.
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  async initialize(): Promise<void> {
    this.storage = await getStorageAdapter(this.instanceId);
  }

  /**
   * Check if a database key has been set up.
   */
  async hasExistingKey(): Promise<boolean> {
    if (!this.storage) await this.initialize();
    const salt = await this.storage?.getSalt();
    return salt !== null;
  }

  /**
   * Set up a new encryption key from a password.
   * Should only be called for new databases.
   */
  async setupNewKey(password: string): Promise<Uint8Array> {
    if (!this.storage) await this.initialize();

    const salt = generateSalt();
    const key = await deriveKeyFromPassword(password, salt);
    const keyBytes = await exportKey(key);

    // Create a key check value for password verification
    const kcv = await this.createKeyCheckValue(keyBytes);

    await this.storage?.setSalt(salt);
    await this.storage?.setKeyCheckValue(kcv);

    this.currentKey = keyBytes;
    return keyBytes;
  }

  /**
   * Unlock an existing database with a password.
   * Returns null if password is incorrect.
   */
  async unlockWithPassword(password: string): Promise<Uint8Array | null> {
    if (!this.storage) await this.initialize();

    const salt = await this.storage?.getSalt();
    if (!salt) {
      throw new Error('No existing key found. Use setupNewKey instead.');
    }

    const key = await deriveKeyFromPassword(password, salt);
    const keyBytes = await exportKey(key);

    // Verify the key check value
    const storedKcv = await this.storage?.getKeyCheckValue();
    const computedKcv = await this.createKeyCheckValue(keyBytes);

    if (storedKcv !== computedKcv) {
      secureZero(keyBytes);
      return null; // Wrong password
    }

    this.currentKey = keyBytes;
    return keyBytes;
  }

  /**
   * Change the encryption password.
   * Returns the new key bytes for re-keying the database.
   */
  async changePassword(
    oldPassword: string,
    newPassword: string
  ): Promise<{ oldKey: Uint8Array; newKey: Uint8Array } | null> {
    // First verify old password
    const oldKey = await this.unlockWithPassword(oldPassword);
    if (!oldKey) return null;

    // Generate new salt and key
    const newSalt = generateSalt();
    const newCryptoKey = await deriveKeyFromPassword(newPassword, newSalt);
    const newKey = await exportKey(newCryptoKey);
    const newKcv = await this.createKeyCheckValue(newKey);

    await this.storage?.setSalt(newSalt);
    await this.storage?.setKeyCheckValue(newKcv);

    this.currentKey = newKey;

    return { oldKey, newKey };
  }

  /**
   * Get the current key (must be unlocked first).
   */
  getCurrentKey(): Uint8Array | null {
    return this.currentKey;
  }

  /**
   * Clear the current key from memory.
   */
  clearKey(): void {
    if (this.currentKey) {
      secureZero(this.currentKey);
      this.currentKey = null;
    }
  }

  /**
   * Reset everything (for testing or complete wipe).
   */
  async reset(): Promise<void> {
    this.clearKey();
    if (!this.storage) await this.initialize();
    await this.storage?.clear();
  }

  /**
   * Persist the current key for session restoration.
   * On web: Uses a non-extractable wrapping key stored in IndexedDB.
   * On mobile: Uses an extractable wrapping key stored in Keychain/Keystore.
   * On Electron: Uses an extractable wrapping key stored via safeStorage API.
   */
  async persistSession(): Promise<boolean> {
    if (!this.currentKey) return false;
    if (!this.storage) await this.initialize();

    try {
      const platform = detectPlatform();
      const useExtractableKey =
        platform === 'ios' || platform === 'android' || platform === 'electron';

      // Generate appropriate wrapping key based on platform
      // Mobile/Electron: extractable (stored in native secure storage)
      // Web: non-extractable (stored in IndexedDB, can't export bytes)
      const wrappingKey = useExtractableKey
        ? await generateExtractableWrappingKey()
        : await generateWrappingKey();

      // Wrap (encrypt) the database key
      const wrappedKey = await wrapKey(this.currentKey, wrappingKey);

      // Store both keys using platform-appropriate storage
      await this.storage?.setWrappingKey(wrappingKey);
      await this.storage?.setWrappedKey(wrappedKey);

      return true;
    } catch (err) {
      console.error('Failed to persist session:', err);
      return false;
    }
  }

  /**
   * Check if a persisted session exists.
   * On mobile, this checks native secure storage without triggering biometric prompt.
   * On Electron, this checks file existence via IPC without decryption.
   */
  async hasPersistedSession(): Promise<boolean> {
    if (!this.storage) await this.initialize();

    const platform = detectPlatform();

    if (platform === 'ios' || platform === 'android') {
      // On mobile, check native storage directly without biometric prompt
      return nativeSecureStorage.hasSession(this.instanceId);
    }

    if (platform === 'electron') {
      // On Electron, use efficient file existence check via IPC
      const api = window.electron?.sqlite;
      if (api?.hasSession) {
        return api.hasSession(this.instanceId);
      }
      return false;
    }

    // On web, check IndexedDB
    const wrappingKey = await this.storage?.getWrappingKey();
    const wrappedKey = await this.storage?.getWrappedKey();

    return wrappingKey !== null && wrappedKey !== null;
  }

  /**
   * Restore a persisted session.
   * On mobile, this triggers biometric authentication.
   * Returns the unwrapped database key if successful.
   */
  async restoreSession(): Promise<Uint8Array | null> {
    if (!this.storage) await this.initialize();

    try {
      const wrappingKey = await this.storage?.getWrappingKey();
      const wrappedKey = await this.storage?.getWrappedKey();

      if (!wrappingKey || !wrappedKey) {
        return null;
      }

      // Unwrap the database key
      const keyBytes = await unwrapKey(wrappedKey, wrappingKey);

      this.currentKey = keyBytes;
      return keyBytes;
    } catch (err) {
      console.error('Failed to restore session:', err);
      // Clear invalid session data
      await this.clearPersistedSession();
      return null;
    }
  }

  /**
   * Clear any persisted session data.
   */
  async clearPersistedSession(): Promise<void> {
    if (!this.storage) await this.initialize();
    await this.storage?.clearSession();
  }

  /**
   * Create a key check value for password verification.
   * This is a hash of the key that can be stored safely.
   */
  private async createKeyCheckValue(keyBytes: Uint8Array): Promise<string> {
    const checkData = new TextEncoder().encode('TEARLEADS_KEY_CHECK');
    const key = await importKey(keyBytes);

    // Encrypt known data with the key
    const iv = new Uint8Array(12); // Zero IV is fine for key check
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      checkData
    );

    // Return base64 of first 16 bytes as check value
    const bytes = new Uint8Array(encrypted).slice(0, 16);
    return btoa(String.fromCharCode(...bytes));
  }
}

// Map of instanceId -> KeyManager for multi-instance support
const keyManagerInstances = new Map<string, KeyManager>();

// Track the current active instance ID
let currentInstanceId: string | null = null;

/**
 * Get a KeyManager for a specific instance.
 */
export function getKeyManagerForInstance(instanceId: string): KeyManager {
  let manager = keyManagerInstances.get(instanceId);
  if (!manager) {
    manager = new KeyManager(instanceId);
    keyManagerInstances.set(instanceId, manager);
  }
  return manager;
}

/**
 * Get the KeyManager for the current active instance.
 * Throws if no instance is active.
 */
export function getKeyManager(): KeyManager {
  if (!currentInstanceId) {
    throw new Error(
      'No active instance. Call setCurrentInstanceId first or use getKeyManagerForInstance.'
    );
  }
  return getKeyManagerForInstance(currentInstanceId);
}

/**
 * Set the current active instance ID.
 */
export function setCurrentInstanceId(instanceId: string | null): void {
  currentInstanceId = instanceId;
}

/**
 * Get the current active instance ID.
 */
export function getCurrentInstanceId(): string | null {
  return currentInstanceId;
}

/**
 * Clear a specific key manager instance.
 */
export function clearKeyManagerForInstance(instanceId: string): void {
  const manager = keyManagerInstances.get(instanceId);
  if (manager) {
    manager.clearKey();
    keyManagerInstances.delete(instanceId);
  }
}

/**
 * Clear all key manager instances.
 */
export function clearAllKeyManagers(): void {
  for (const manager of keyManagerInstances.values()) {
    manager.clearKey();
  }
  keyManagerInstances.clear();
  currentInstanceId = null;
}

/**
 * Check if biometric authentication is available on this device.
 * Only applicable on iOS and Android.
 */
export async function isBiometricAvailable(): Promise<nativeSecureStorage.BiometricAvailability> {
  const platform = detectPlatform();
  if (platform !== 'ios' && platform !== 'android') {
    return { isAvailable: false };
  }
  return nativeSecureStorage.isBiometricAvailable();
}

/**
 * Key status for an instance (existence only, no values).
 */
interface KeyStatus {
  salt: boolean;
  keyCheckValue: boolean;
  wrappingKey: boolean;
  wrappedKey: boolean;
}

/**
 * Check which keys exist for an instance without unlocking.
 * Safe to call without authentication - only returns boolean existence.
 * Uses the platform-aware storage adapter for cross-platform compatibility.
 */
export async function getKeyStatusForInstance(
  instanceId: string
): Promise<KeyStatus> {
  const storage = await getStorageAdapter(instanceId);

  const [salt, keyCheckValue, sessionKeys] = await Promise.all([
    storage.getSalt(),
    storage.getKeyCheckValue(),
    storage.hasSessionKeys()
  ]);

  return {
    salt: salt !== null,
    keyCheckValue: keyCheckValue !== null,
    wrappingKey: sessionKeys.wrappingKey,
    wrappedKey: sessionKeys.wrappedKey
  };
}

/**
 * Delete only session keys (wrapping key + wrapped key) for an instance.
 * This ends the session but preserves the database encryption setup.
 * Uses the platform-aware storage adapter for cross-platform compatibility.
 */
export async function deleteSessionKeysForInstance(
  instanceId: string
): Promise<void> {
  const storage = await getStorageAdapter(instanceId);
  await storage.clearSession();
}

export { validateAndPruneOrphanedInstances } from './keyManagerOrphans';
