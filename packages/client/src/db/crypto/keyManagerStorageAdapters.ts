import { exportWrappingKey, importWrappingKey } from '@tearleads/shared';
import { detectPlatform } from '@/lib/utils';
import * as nativeSecureStorage from './nativeSecureStorage';

// Base storage key prefixes - instanceId is appended
const SALT_STORAGE_PREFIX = 'tearleads_db_salt';
const KEY_CHECK_VALUE_PREFIX = 'tearleads_db_kcv';
const WRAPPING_KEY_STORAGE_PREFIX = 'tearleads_session_wrapping_key';
const WRAPPED_KEY_STORAGE_PREFIX = 'tearleads_session_wrapped_key';

/**
 * Get namespaced storage key for an instance.
 */
function getStorageKey(prefix: string, instanceId: string): string {
  return `${prefix}_${instanceId}`;
}

export interface KeyStorageAdapter {
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
 * Get the storage adapter based on platform.
 */
export async function getStorageAdapter(
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

/**
 * Web storage adapter using IndexedDB.
 */
class WebKeyStorage implements KeyStorageAdapter {
  private dbName = 'tearleads_key_storage';
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
      let settled = false;
      const rejectOnce = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(error);
      };

      request.onerror = () => rejectOnce(request.error);
      tx.onabort = () => rejectOnce(tx.error ?? request.error);
      tx.oncomplete = () => {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        if (request.error) {
          reject(request.error);
          return;
        }
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
      let settled = false;
      const rejectOnce = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(error);
      };

      request.onerror = () => rejectOnce(request.error);
      tx.onabort = () => rejectOnce(tx.error ?? request.error);
      tx.oncomplete = () => {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        if (request.error) {
          reject(request.error);
          return;
        }
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
