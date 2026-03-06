import { exportWrappingKey, importWrappingKey } from '@tearleads/shared';
import { detectPlatform } from './detectPlatform.js';
import * as nativeSecureStorage from './nativeSecureStorage.js';

const SALT_STORAGE_PREFIX = 'tearleads_db_salt';
const KEY_CHECK_VALUE_PREFIX = 'tearleads_db_kcv';
const PASSWORD_WRAPPED_KEY_PREFIX = 'tearleads_db_password_wrapped_key';
const WRAPPING_KEY_STORAGE_PREFIX = 'tearleads_session_wrapping_key';
const WRAPPED_KEY_STORAGE_PREFIX = 'tearleads_session_wrapped_key';

function getStorageKey(prefix: string, instanceId: string): string {
  return `${prefix}_${instanceId}`;
}

export interface KeyStorageAdapter {
  instanceId: string;
  getSalt(): Promise<Uint8Array | null>;
  setSalt(salt: Uint8Array): Promise<void>;
  getKeyCheckValue(): Promise<string | null>;
  setKeyCheckValue(kcv: string): Promise<void>;
  getPasswordWrappedKey(): Promise<Uint8Array | null>;
  setPasswordWrappedKey(wrappedKey: Uint8Array): Promise<void>;
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

class WebKeyStorage implements KeyStorageAdapter {
  private dbName = 'tearleads_key_storage';
  private storeName = 'keys';
  public instanceId: string;

  // Namespaced storage keys
  private saltKey: string;
  private kcvKey: string;
  private passwordWrappedKey: string;
  private wrappingKeyKey: string;
  private wrappedKeyKey: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.saltKey = getStorageKey(SALT_STORAGE_PREFIX, instanceId);
    this.kcvKey = getStorageKey(KEY_CHECK_VALUE_PREFIX, instanceId);
    this.passwordWrappedKey = getStorageKey(
      PASSWORD_WRAPPED_KEY_PREFIX,
      instanceId
    );
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

  async getPasswordWrappedKey(): Promise<Uint8Array | null> {
    const stored = await this.get<number[]>(this.passwordWrappedKey);
    return stored ? new Uint8Array(stored) : null;
  }

  async setPasswordWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    await this.set(this.passwordWrappedKey, Array.from(wrappedKey));
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.deleteKey(this.saltKey),
      this.deleteKey(this.kcvKey),
      this.deleteKey(this.passwordWrappedKey),
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

  async getPasswordWrappedKey(): Promise<Uint8Array | null> {
    const api = this.getApi();
    if (!api?.getPasswordWrappedKey) return null;
    const stored = await api.getPasswordWrappedKey(this.instanceId);
    return stored ? new Uint8Array(stored) : null;
  }

  async setPasswordWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    const api = this.getApi();
    if (!api?.setPasswordWrappedKey) return;
    await api.setPasswordWrappedKey(Array.from(wrappedKey), this.instanceId);
  }

  async clear(): Promise<void> {
    const api = this.getApi();
    if (api?.clearKeyStorage) {
      await api.clearKeyStorage(this.instanceId);
    }
    // Also clear session data
    await this.clearSession();
  }

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

  async setWrappingKey(key: CryptoKey): Promise<void> {
    const api = this.getApi();
    if (!api?.setWrappingKey) return;

    const keyBytes = await exportWrappingKey(key);
    await api.setWrappingKey(Array.from(keyBytes), this.instanceId);
  }

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

  async setWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    const api = this.getApi();
    if (!api?.setWrappedKey) return;

    await api.setWrappedKey(Array.from(wrappedKey), this.instanceId);
  }

  async clearSession(): Promise<void> {
    const api = this.getApi();
    if (api?.clearSession) {
      await api.clearSession(this.instanceId);
    }
  }

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

class CapacitorKeyStorage implements KeyStorageAdapter {
  public instanceId: string;
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

  async getPasswordWrappedKey(): Promise<Uint8Array | null> {
    return this.storage.getPasswordWrappedKey();
  }

  async setPasswordWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    return this.storage.setPasswordWrappedKey(wrappedKey);
  }

  async clear(): Promise<void> {
    await this.storage.clear();
    await nativeSecureStorage.clearSession(this.instanceId);
  }

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

  async setWrappedKey(wrappedKey: Uint8Array): Promise<void> {
    const success = await nativeSecureStorage.storeWrappedKey(
      this.instanceId,
      wrappedKey
    );
    if (!success) {
      throw new Error('Failed to store wrapped key in native secure storage.');
    }
  }

  async clearSession(): Promise<void> {
    await nativeSecureStorage.clearSession(this.instanceId);
  }

  async hasSessionKeys(): Promise<{
    wrappingKey: boolean;
    wrappedKey: boolean;
  }> {
    const hasSession = await nativeSecureStorage.hasSession(this.instanceId);
    return {
      wrappingKey: hasSession,
      wrappedKey: hasSession
    };
  }
}
