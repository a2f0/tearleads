/**
 * Key management for database encryption.
 * Handles key derivation and secure storage per platform.
 */

import { detectPlatform } from '@/lib/utils';
import {
  deriveKeyFromPassword,
  exportKey,
  generateSalt,
  generateWrappingKey,
  importKey,
  secureZero,
  unwrapKey,
  wrapKey
} from './web-crypto';

const SALT_STORAGE_KEY = 'rapid_db_salt';
const KEY_CHECK_VALUE = 'rapid_db_kcv';
const WRAPPING_KEY_STORAGE = 'rapid_session_wrapping_key';
const WRAPPED_KEY_STORAGE = 'rapid_session_wrapped_key';

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
  // Session persistence (web only)
  getWrappingKey(): Promise<CryptoKey | null>;
  setWrappingKey(key: CryptoKey): Promise<void>;
  getWrappedKey(): Promise<Uint8Array | null>;
  setWrappedKey(wrappedKey: Uint8Array): Promise<void>;
  clearSession(): Promise<void>;
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

  async getWrappingKey(): Promise<CryptoKey | null> {
    return this.get<CryptoKey>(WRAPPING_KEY_STORAGE);
  }

  async setWrappingKey(key: CryptoKey): Promise<void> {
    await this.set(WRAPPING_KEY_STORAGE, key);
  }

  async getWrappedKey(): Promise<Uint8Array | null> {
    const stored = await this.get<number[]>(WRAPPED_KEY_STORAGE);
    return stored ? new Uint8Array(stored) : null;
  }

  async setWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    await this.set(WRAPPED_KEY_STORAGE, Array.from(wrappedKey));
  }

  async clearSession(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);

      // Delete only session-related keys, not the salt/kcv
      store.delete(WRAPPING_KEY_STORAGE);
      store.delete(WRAPPED_KEY_STORAGE);

      tx.onerror = () => reject(tx.error);
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
  private getApi() {
    return window.electron?.sqlite;
  }

  async getSalt(): Promise<Uint8Array | null> {
    const api = this.getApi();
    if (!api?.getSalt) return null;
    const stored = await api.getSalt();
    return stored ? new Uint8Array(stored) : null;
  }

  async setSalt(salt: Uint8Array): Promise<void> {
    const api = this.getApi();
    if (api?.setSalt) {
      await api.setSalt(Array.from(salt));
    }
  }

  async getKeyCheckValue(): Promise<string | null> {
    const api = this.getApi();
    if (!api?.getKeyCheckValue) return null;
    return api.getKeyCheckValue();
  }

  async setKeyCheckValue(kcv: string): Promise<void> {
    const api = this.getApi();
    if (api?.setKeyCheckValue) {
      await api.setKeyCheckValue(kcv);
    }
  }

  async clear(): Promise<void> {
    const api = this.getApi();
    if (api?.clearKeyStorage) {
      await api.clearKeyStorage();
    }
  }

  // Session persistence not supported on Electron (uses native secure storage)
  async getWrappingKey(): Promise<CryptoKey | null> {
    return null;
  }
  async setWrappingKey(_key: CryptoKey): Promise<void> {}
  async getWrappedKey(): Promise<Uint8Array | null> {
    return null;
  }
  async setWrappedKey(_wrappedKey: Uint8Array): Promise<void> {}
  async clearSession(): Promise<void> {}
}

/**
 * Capacitor storage adapter.
 * Uses IndexedDB (WebKeyStorage) which works reliably in mobile WebViews.
 * Note: @capacitor/preferences has compatibility issues with dynamic imports,
 * and IndexedDB provides sufficient persistence for encryption salt storage.
 */
class CapacitorKeyStorage implements KeyStorageAdapter {
  // Use IndexedDB directly - it works well in Capacitor WebViews
  private storage = new WebKeyStorage();

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
    return this.storage.clear();
  }

  // Session persistence not supported on mobile (security concern)
  async getWrappingKey(): Promise<CryptoKey | null> {
    return null;
  }
  async setWrappingKey(_key: CryptoKey): Promise<void> {}
  async getWrappedKey(): Promise<Uint8Array | null> {
    return null;
  }
  async setWrappedKey(_wrappedKey: Uint8Array): Promise<void> {}
  async clearSession(): Promise<void> {}
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
   * Persist the current key for session restoration (web only).
   * Uses a non-extractable wrapping key to securely store the database key.
   */
  async persistSession(): Promise<boolean> {
    if (!this.currentKey) return false;
    if (!this.storage) await this.initialize();

    try {
      // Generate a non-extractable wrapping key
      const wrappingKey = await generateWrappingKey();

      // Wrap (encrypt) the database key
      const wrappedKey = await wrapKey(this.currentKey, wrappingKey);

      // Store both in IndexedDB
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
   */
  async hasPersistedSession(): Promise<boolean> {
    if (!this.storage) await this.initialize();

    const wrappingKey = await this.storage?.getWrappingKey();
    const wrappedKey = await this.storage?.getWrappedKey();

    return wrappingKey !== null && wrappedKey !== null;
  }

  /**
   * Restore a persisted session (web only).
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

// Singleton instance
let keyManagerInstance: KeyManager | null = null;

export function getKeyManager(): KeyManager {
  if (!keyManagerInstance) {
    keyManagerInstance = new KeyManager();
  }
  return keyManagerInstance;
}
