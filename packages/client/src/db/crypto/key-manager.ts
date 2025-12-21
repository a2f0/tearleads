/**
 * Key management for database encryption.
 * Handles key derivation and secure storage per platform.
 */

import { detectPlatform } from '@/lib/utils';
import {
  deriveKeyFromPassword,
  exportKey,
  generateSalt,
  importKey,
  secureZero
} from './web-crypto';

const SALT_STORAGE_KEY = 'rapid_db_salt';
const KEY_CHECK_VALUE = 'rapid_db_kcv';

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
async function getStorageAdapter(): Promise<KeyStorageAdapter> {
  const platform = detectPlatform();

  switch (platform) {
    case 'electron':
      return new ElectronKeyStorage();
    case 'ios':
    case 'android':
      return new CapacitorKeyStorage();
    default:
      return new WebKeyStorage();
  }
}

interface KeyStorageAdapter {
  getSalt(): Promise<Uint8Array | null>;
  setSalt(salt: Uint8Array): Promise<void>;
  getKeyCheckValue(): Promise<string | null>;
  setKeyCheckValue(kcv: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Web storage adapter using IndexedDB.
 */
class WebKeyStorage implements KeyStorageAdapter {
  private dbName = 'rapid_key_storage';
  private storeName = 'keys';

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

  async getSalt(): Promise<Uint8Array | null> {
    const stored = await this.get<number[]>(SALT_STORAGE_KEY);
    return stored ? new Uint8Array(stored) : null;
  }

  async setSalt(salt: Uint8Array): Promise<void> {
    await this.set(SALT_STORAGE_KEY, Array.from(salt));
  }

  async getKeyCheckValue(): Promise<string | null> {
    return this.get<string>(KEY_CHECK_VALUE);
  }

  async setKeyCheckValue(kcv: string): Promise<void> {
    await this.set(KEY_CHECK_VALUE, kcv);
  }

  async clear(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    });
  }
}

/**
 * Electron storage adapter using safeStorage API via IPC.
 */
class ElectronKeyStorage implements KeyStorageAdapter {
  async getSalt(): Promise<Uint8Array | null> {
    const api = (
      window as unknown as {
        electron?: { getSalt?: () => Promise<number[] | null> };
      }
    ).electron;
    if (!api?.getSalt) return null;
    const stored = await api.getSalt();
    return stored ? new Uint8Array(stored) : null;
  }

  async setSalt(salt: Uint8Array): Promise<void> {
    const api = (
      window as unknown as {
        electron?: { setSalt?: (salt: number[]) => Promise<void> };
      }
    ).electron;
    if (api?.setSalt) {
      await api.setSalt(Array.from(salt));
    }
  }

  async getKeyCheckValue(): Promise<string | null> {
    const api = (
      window as unknown as {
        electron?: { getKeyCheckValue?: () => Promise<string | null> };
      }
    ).electron;
    if (!api?.getKeyCheckValue) return null;
    return api.getKeyCheckValue();
  }

  async setKeyCheckValue(kcv: string): Promise<void> {
    const api = (
      window as unknown as {
        electron?: { setKeyCheckValue?: (kcv: string) => Promise<void> };
      }
    ).electron;
    if (api?.setKeyCheckValue) {
      await api.setKeyCheckValue(kcv);
    }
  }

  async clear(): Promise<void> {
    const api = (
      window as unknown as {
        electron?: { clearKeyStorage?: () => Promise<void> };
      }
    ).electron;
    if (api?.clearKeyStorage) {
      await api.clearKeyStorage();
    }
  }
}

/**
 * Capacitor storage adapter using secure storage plugin.
 * Falls back to WebKeyStorage if plugin not available.
 */
class CapacitorKeyStorage implements KeyStorageAdapter {
  private fallback = new WebKeyStorage();

  private async getPlugin(): Promise<unknown | null> {
    try {
      // Dynamic import to avoid bundling in non-native builds
      // Uses @capacitor/preferences which stores in iOS Keychain / Android SharedPreferences
      const { Preferences } = await import('@capacitor/preferences');
      return Preferences;
    } catch {
      return null;
    }
  }

  async getSalt(): Promise<Uint8Array | null> {
    const plugin = await this.getPlugin();
    if (!plugin) return this.fallback.getSalt();

    try {
      const result = await (
        plugin as { get: (opts: { key: string }) => Promise<{ value: string }> }
      ).get({
        key: SALT_STORAGE_KEY
      });
      return result?.value
        ? new Uint8Array(JSON.parse(result.value) as number[])
        : null;
    } catch {
      return null;
    }
  }

  async setSalt(salt: Uint8Array): Promise<void> {
    const plugin = await this.getPlugin();
    if (!plugin) return this.fallback.setSalt(salt);

    await (
      plugin as {
        set: (opts: { key: string; value: string }) => Promise<void>;
      }
    ).set({
      key: SALT_STORAGE_KEY,
      value: JSON.stringify(Array.from(salt))
    });
  }

  async getKeyCheckValue(): Promise<string | null> {
    const plugin = await this.getPlugin();
    if (!plugin) return this.fallback.getKeyCheckValue();

    try {
      const result = await (
        plugin as { get: (opts: { key: string }) => Promise<{ value: string }> }
      ).get({
        key: KEY_CHECK_VALUE
      });
      return result?.value ?? null;
    } catch {
      return null;
    }
  }

  async setKeyCheckValue(kcv: string): Promise<void> {
    const plugin = await this.getPlugin();
    if (!plugin) return this.fallback.setKeyCheckValue(kcv);

    await (
      plugin as {
        set: (opts: { key: string; value: string }) => Promise<void>;
      }
    ).set({
      key: KEY_CHECK_VALUE,
      value: kcv
    });
  }

  async clear(): Promise<void> {
    const plugin = await this.getPlugin();
    if (!plugin) return this.fallback.clear();

    // Clear just our keys, not all preferences
    const preferences = plugin as {
      remove: (opts: { key: string }) => Promise<void>;
    };
    await preferences.remove({ key: SALT_STORAGE_KEY });
    await preferences.remove({ key: KEY_CHECK_VALUE });
  }
}

/**
 * Key manager class for handling encryption key lifecycle.
 */
export class KeyManager {
  private storage: KeyStorageAdapter | null = null;
  private currentKey: Uint8Array | null = null;

  async initialize(): Promise<void> {
    this.storage = await getStorageAdapter();
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

    // Update storage
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

// Singleton instance
let keyManagerInstance: KeyManager | null = null;

export function getKeyManager(): KeyManager {
  if (!keyManagerInstance) {
    keyManagerInstance = new KeyManager();
  }
  return keyManagerInstance;
}
