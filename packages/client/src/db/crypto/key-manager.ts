/**
 * Key management for database encryption.
 * Handles key derivation and secure storage per platform.
 * Supports multi-instance with namespaced storage keys.
 */

import {
  deriveKeyFromPassword,
  exportKey,
  exportWrappingKey,
  generateExtractableWrappingKey,
  generateSalt,
  generateWrappingKey,
  importKey,
  importWrappingKey,
  secureZero,
  unwrapKey,
  wrapKey
} from '@rapid/shared';
import { detectPlatform } from '@/lib/utils';
import * as nativeSecureStorage from './native-secure-storage';

// Base storage key prefixes - instanceId is appended
const SALT_STORAGE_PREFIX = 'rapid_db_salt';
const KEY_CHECK_VALUE_PREFIX = 'rapid_db_kcv';
const WRAPPING_KEY_STORAGE_PREFIX = 'rapid_session_wrapping_key';
const WRAPPED_KEY_STORAGE_PREFIX = 'rapid_session_wrapped_key';

/**
 * Get namespaced storage key for an instance.
 */
function getStorageKey(prefix: string, instanceId: string): string {
  return `${prefix}_${instanceId}`;
}

export interface KeyManagerConfig {
  databaseName: string;
}

export interface StoredKeyData {
  salt: Uint8Array;
  keyCheckValue: string; // Used to verify correct password
}

/**
 * Get the storage adapter based on platform.
 */
async function getStorageAdapter(
  instanceId: string
): Promise<KeyStorageAdapter> {
  const platform = detectPlatform();

  switch (platform) {
    case 'electron':
      return new ElectronKeyStorage(instanceId);
    case 'ios':
    case 'android':
      return new CapacitorKeyStorage(instanceId);
    default:
      return new WebKeyStorage(instanceId);
  }
}

interface KeyStorageAdapter {
  instanceId: string;
  getSalt(): Promise<Uint8Array | null>;
  setSalt(salt: Uint8Array): Promise<void>;
  getKeyCheckValue(): Promise<string | null>;
  setKeyCheckValue(kcv: string): Promise<void>;
  clear(): Promise<void>;
  // Session persistence (web only)
  getWrappingKey(): Promise<CryptoKey | null>;
  setWrappingKey(key: CryptoKey): Promise<void>;
  getWrappedKey(): Promise<Uint8Array | null>;
  setWrappedKey(wrappedKey: Uint8Array): Promise<void>;
  clearSession(): Promise<void>;
  // Check session key existence without triggering biometric (for status display)
  hasSessionKeys(): Promise<{ wrappingKey: boolean; wrappedKey: boolean }>;
}

/**
 * Web storage adapter using IndexedDB.
 */
class WebKeyStorage implements KeyStorageAdapter {
  private dbName = 'rapid_key_storage';
  private storeName = 'keys';
  public instanceId: string;

  // Namespaced storage keys
  private saltKey: string;
  private kcvKey: string;
  private wrappingKeyKey: string;
  private wrappedKeyKey: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.saltKey = getStorageKey(SALT_STORAGE_PREFIX, instanceId);
    this.kcvKey = getStorageKey(KEY_CHECK_VALUE_PREFIX, instanceId);
    this.wrappingKeyKey = getStorageKey(
      WRAPPING_KEY_STORAGE_PREFIX,
      instanceId
    );
    this.wrappedKeyKey = getStorageKey(WRAPPED_KEY_STORAGE_PREFIX, instanceId);
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  private async get<T>(key: string): Promise<T | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);

      tx.oncomplete = () => db.close();
    });
  }

  private async set(key: string, value: unknown): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    });
  }

  private async deleteKey(key: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    });
  }

  async getSalt(): Promise<Uint8Array | null> {
    const stored = await this.get<number[]>(this.saltKey);
    return stored ? new Uint8Array(stored) : null;
  }

  async setSalt(salt: Uint8Array): Promise<void> {
    await this.set(this.saltKey, Array.from(salt));
  }

  async getKeyCheckValue(): Promise<string | null> {
    return this.get<string>(this.kcvKey);
  }

  async setKeyCheckValue(kcv: string): Promise<void> {
    await this.set(this.kcvKey, kcv);
  }

  async clear(): Promise<void> {
    // Delete only keys for this instance, not all keys
    await Promise.all([
      this.deleteKey(this.saltKey),
      this.deleteKey(this.kcvKey),
      this.deleteKey(this.wrappingKeyKey),
      this.deleteKey(this.wrappedKeyKey)
    ]);
  }

  async getWrappingKey(): Promise<CryptoKey | null> {
    return this.get<CryptoKey>(this.wrappingKeyKey);
  }

  async setWrappingKey(key: CryptoKey): Promise<void> {
    await this.set(this.wrappingKeyKey, key);
  }

  async getWrappedKey(): Promise<Uint8Array | null> {
    const stored = await this.get<number[]>(this.wrappedKeyKey);
    return stored ? new Uint8Array(stored) : null;
  }

  async setWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    await this.set(this.wrappedKeyKey, Array.from(wrappedKey));
  }

  async clearSession(): Promise<void> {
    // Delete only session-related keys for this instance
    await Promise.all([
      this.deleteKey(this.wrappingKeyKey),
      this.deleteKey(this.wrappedKeyKey)
    ]);
  }

  async hasSessionKeys(): Promise<{
    wrappingKey: boolean;
    wrappedKey: boolean;
  }> {
    const wrappingKey = await this.get<CryptoKey>(this.wrappingKeyKey);
    const wrappedKey = await this.get<number[]>(this.wrappedKeyKey);
    return {
      wrappingKey: wrappingKey !== null,
      wrappedKey: wrappedKey !== null
    };
  }
}

/**
 * Electron storage adapter using safeStorage API via IPC.
 * Session persistence uses extractable wrapping keys stored via main process
 * with Electron's safeStorage API (OS-level encryption).
 */
class ElectronKeyStorage implements KeyStorageAdapter {
  public instanceId: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  private getApi() {
    return window.electron?.sqlite;
  }

  async getSalt(): Promise<Uint8Array | null> {
    const api = this.getApi();
    if (!api?.getSalt) return null;
    const stored = await api.getSalt(this.instanceId);
    return stored ? new Uint8Array(stored) : null;
  }

  async setSalt(salt: Uint8Array): Promise<void> {
    const api = this.getApi();
    if (api?.setSalt) {
      await api.setSalt(Array.from(salt), this.instanceId);
    }
  }

  async getKeyCheckValue(): Promise<string | null> {
    const api = this.getApi();
    if (!api?.getKeyCheckValue) return null;
    return api.getKeyCheckValue(this.instanceId);
  }

  async setKeyCheckValue(kcv: string): Promise<void> {
    const api = this.getApi();
    if (api?.setKeyCheckValue) {
      await api.setKeyCheckValue(kcv, this.instanceId);
    }
  }

  async clear(): Promise<void> {
    const api = this.getApi();
    if (api?.clearKeyStorage) {
      await api.clearKeyStorage(this.instanceId);
    }
    // Also clear session data
    await this.clearSession();
  }

  /**
   * Get the wrapping key from Electron's secure storage.
   * The key is stored as extractable bytes and imported back to a CryptoKey.
   */
  async getWrappingKey(): Promise<CryptoKey | null> {
    const api = this.getApi();
    if (!api?.getWrappingKey) return null;

    try {
      const keyBytes = await api.getWrappingKey(this.instanceId);
      if (!keyBytes) return null;
      return importWrappingKey(new Uint8Array(keyBytes));
    } catch (error) {
      console.error('Failed to get wrapping key from Electron storage:', error);
      return null;
    }
  }

  /**
   * Store the wrapping key in Electron's secure storage.
   * The key is exported to bytes and stored via IPC.
   */
  async setWrappingKey(key: CryptoKey): Promise<void> {
    const api = this.getApi();
    if (!api?.setWrappingKey) return;

    const keyBytes = await exportWrappingKey(key);
    await api.setWrappingKey(Array.from(keyBytes), this.instanceId);
  }

  /**
   * Get the wrapped key from Electron's secure storage.
   */
  async getWrappedKey(): Promise<Uint8Array | null> {
    const api = this.getApi();
    if (!api?.getWrappedKey) return null;

    try {
      const stored = await api.getWrappedKey(this.instanceId);
      return stored ? new Uint8Array(stored) : null;
    } catch (error) {
      console.error('Failed to get wrapped key from Electron storage:', error);
      return null;
    }
  }

  /**
   * Store the wrapped key in Electron's secure storage.
   */
  async setWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    const api = this.getApi();
    if (!api?.setWrappedKey) return;

    await api.setWrappedKey(Array.from(wrappedKey), this.instanceId);
  }

  /**
   * Clear session data from Electron's secure storage.
   */
  async clearSession(): Promise<void> {
    const api = this.getApi();
    if (api?.clearSession) {
      await api.clearSession(this.instanceId);
    }
  }

  /**
   * Check if session keys exist via hasSession IPC.
   */
  async hasSessionKeys(): Promise<{
    wrappingKey: boolean;
    wrappedKey: boolean;
  }> {
    const api = this.getApi();
    if (!api?.hasSession) {
      return { wrappingKey: false, wrappedKey: false };
    }
    const hasSession = await api.hasSession(this.instanceId);
    return { wrappingKey: hasSession, wrappedKey: hasSession };
  }
}

/**
 * Capacitor storage adapter for iOS and Android.
 * Uses IndexedDB for salt/KCV (don't need biometric protection).
 * Uses native Keychain/Keystore for session keys (secure storage).
 *
 * Note: iOS Keychain and Android Keystore provide secure storage by default.
 * We don't require biometric verification for key retrieval during auto-restore
 * because biometric checks can silently fail during app cold start (plugin not ready).
 * The Keychain/Keystore security is sufficient for session persistence.
 */
class CapacitorKeyStorage implements KeyStorageAdapter {
  public instanceId: string;
  // Use IndexedDB for salt and KCV - they don't need biometric protection
  private storage: WebKeyStorage;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.storage = new WebKeyStorage(instanceId);
  }

  async getSalt(): Promise<Uint8Array | null> {
    return this.storage.getSalt();
  }

  async setSalt(salt: Uint8Array): Promise<void> {
    return this.storage.setSalt(salt);
  }

  async getKeyCheckValue(): Promise<string | null> {
    return this.storage.getKeyCheckValue();
  }

  async setKeyCheckValue(kcv: string): Promise<void> {
    return this.storage.setKeyCheckValue(kcv);
  }

  async clear(): Promise<void> {
    await this.storage.clear();
    await nativeSecureStorage.clearSession(this.instanceId);
  }

  /**
   * Get the wrapping key from native secure storage.
   * On mobile, we store an extractable wrapping key in Keychain/Keystore.
   */
  async getWrappingKey(): Promise<CryptoKey | null> {
    try {
      const keyBytes = await nativeSecureStorage.retrieveWrappingKeyBytes(
        this.instanceId
      );
      if (!keyBytes) return null;
      return importWrappingKey(keyBytes);
    } catch (error) {
      console.error('Failed to get wrapping key from secure storage:', error);
      return null;
    }
  }

  /**
   * Store the wrapping key in native secure storage.
   * On mobile, we export the key to bytes and store in Keychain/Keystore.
   */
  async setWrappingKey(key: CryptoKey): Promise<void> {
    const keyBytes = await exportWrappingKey(key);
    const success = await nativeSecureStorage.storeWrappingKeyBytes(
      this.instanceId,
      keyBytes
    );
    if (!success) {
      throw new Error('Failed to store wrapping key in native secure storage.');
    }
  }

  /**
   * Get the wrapped key from native secure storage.
   * Does not require biometric - the Keychain/Keystore security is sufficient.
   * Biometric checks can fail silently during cold start when the plugin isn't ready.
   */
  async getWrappedKey(): Promise<Uint8Array | null> {
    try {
      return nativeSecureStorage.retrieveWrappedKey(this.instanceId, {
        useBiometric: false
      });
    } catch (error) {
      console.error('Failed to get wrapped key from secure storage:', error);
      return null;
    }
  }

  /**
   * Store the wrapped key in native secure storage.
   */
  async setWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    const success = await nativeSecureStorage.storeWrappedKey(
      this.instanceId,
      wrappedKey
    );
    if (!success) {
      throw new Error('Failed to store wrapped key in native secure storage.');
    }
  }

  /**
   * Clear session data from native secure storage.
   */
  async clearSession(): Promise<void> {
    await nativeSecureStorage.clearSession(this.instanceId);
  }

  /**
   * Check if session keys exist without triggering biometric.
   */
  async hasSessionKeys(): Promise<{
    wrappingKey: boolean;
    wrappedKey: boolean;
  }> {
    const hasSession = await nativeSecureStorage.hasSession(this.instanceId);
    // If hasSession returns true, both wrapping and wrapped keys exist
    return {
      wrappingKey: hasSession,
      wrappedKey: hasSession
    };
  }
}

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
    const checkData = new TextEncoder().encode('RAPID_KEY_CHECK');
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
export interface KeyStatus {
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
