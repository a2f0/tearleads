/**
 * Unit tests for KeyManager.
 *
 * These tests mock the underlying crypto operations to test
 * the KeyManager's logic in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllKeyManagers,
  clearKeyManagerForInstance,
  deleteSessionKeysForInstance,
  getCurrentInstanceId,
  getKeyManager,
  getKeyManagerForInstance,
  getKeyStatusForInstance,
  isBiometricAvailable,
  KeyManager,
  setCurrentInstanceId,
  validateAndPruneOrphanedInstances
} from './key-manager';

let keyBytesByKey = new WeakMap<object, Uint8Array>();

// Mock the @rapid/shared crypto module
vi.mock('@rapid/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rapid/shared')>();
  const passwordByKey = new WeakMap<object, string>();

  const createMockCryptoKey = () => ({
    type: 'secret',
    extractable: true,
    algorithm: { name: 'AES-GCM' },
    usages: ['encrypt', 'decrypt']
  });

  const encodePassword = (password: string) => {
    const bytes = new Uint8Array(32);
    const sum = Array.from(password).reduce(
      (total, char) => total + char.charCodeAt(0),
      0
    );
    bytes.fill(sum % 255);
    return bytes;
  };

  return {
    ...original,
    generateSalt: vi.fn(() => new Uint8Array(32).fill(1)),
    deriveKeyFromPassword: vi.fn(async (password: string) => {
      const key = createMockCryptoKey();
      passwordByKey.set(key, password);
      return key;
    }),
    exportKey: vi.fn(async (key: CryptoKey) => {
      const password =
        typeof key === 'object' && key !== null
          ? (passwordByKey.get(key) ?? 'default')
          : 'default';
      return encodePassword(password);
    }),
    importKey: vi.fn(async (keyBytes: Uint8Array) => {
      const key = createMockCryptoKey();
      keyBytesByKey.set(key, keyBytes);
      return key;
    }),
    secureZero: vi.fn(),
    generateWrappingKey: vi.fn(async () => createMockCryptoKey()),
    generateExtractableWrappingKey: vi.fn(async () => createMockCryptoKey()),
    wrapKey: vi.fn(async () => new Uint8Array(48).fill(3)),
    unwrapKey: vi.fn(async () => new Uint8Array(32).fill(2)),
    exportWrappingKey: vi.fn(async () => new Uint8Array(32).fill(4)),
    importWrappingKey: vi.fn(async () => createMockCryptoKey())
  };
});

vi.mock('./native-secure-storage', () => ({
  clearSession: vi.fn(async () => undefined),
  getTrackedKeystoreInstanceIds: vi.fn(async () => []),
  hasSession: vi.fn(async () => false),
  isBiometricAvailable: vi.fn(async () => ({ isAvailable: false })),
  retrieveWrappedKey: vi.fn(async () => null),
  retrieveWrappingKeyBytes: vi.fn(async () => null),
  storeWrappedKey: vi.fn(async () => true),
  storeWrappingKeyBytes: vi.fn(async () => true)
}));

// Mock crypto.subtle for KCV generation
const mockEncrypt = vi.fn(async (_algo, key) => {
  const buffer = new Uint8Array(32);
  if (typeof key === 'object' && key !== null) {
    const keyBytes = keyBytesByKey.get(key);
    if (keyBytes) {
      buffer.set(keyBytes.slice(0, 32));
    }
  }
  return buffer.buffer;
});
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      encrypt: mockEncrypt
    },
    getRandomValues: vi.fn((arr: Uint8Array) => arr.fill(0))
  }
});

// Mock IndexedDB for WebKeyStorage
const mockIDBStore = new Map<string, unknown>();
const mockIDBRequest = (result: unknown) => ({
  result,
  error: null,
  onsuccess: null as (() => void) | null,
  onerror: null as (() => void) | null
});

const mockObjectStore = {
  get: vi.fn((key: string) => {
    const req = mockIDBRequest(mockIDBStore.get(key));
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  put: vi.fn((value: unknown, key: string) => {
    mockIDBStore.set(key, value);
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  delete: vi.fn((key: string) => {
    mockIDBStore.delete(key);
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  clear: vi.fn(() => {
    mockIDBStore.clear();
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  })
};

function createMockTransaction() {
  const tx = {
    objectStore: vi.fn(() => mockObjectStore),
    oncomplete: null as (() => void) | null
  };
  // Schedule oncomplete to fire after current operations
  setTimeout(() => tx.oncomplete?.(), 10);
  return tx;
}

const mockDB = {
  transaction: vi.fn(() => createMockTransaction()),
  close: vi.fn(),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn()
};

const createOpenRequest = () => ({
  result: mockDB,
  error: null,
  onsuccess: null as (() => void) | null,
  onerror: null as (() => void) | null,
  onupgradeneeded: null as (() => void) | null
});

vi.stubGlobal('indexedDB', {
  open: vi.fn(() => {
    const request = createOpenRequest();
    setTimeout(() => {
      if (mockDB.objectStoreNames.contains()) {
        request.onsuccess?.();
        return;
      }
      request.onupgradeneeded?.();
      request.onsuccess?.();
    }, 0);
    return request;
  })
});

const flushTimers = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
};

// Mock detectPlatform to return 'web'
vi.mock('@/lib/utils', () => ({
  detectPlatform: vi.fn(() => 'web')
}));

const TEST_INSTANCE_ID = 'test-instance';

describe('KeyManager', () => {
  let keyManager: KeyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    keyBytesByKey = new WeakMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    keyManager = new KeyManager(TEST_INSTANCE_ID);
  });

  describe('hasExistingKey', () => {
    it('returns false when no salt is stored', async () => {
      const result = await keyManager.hasExistingKey();
      expect(result).toBe(false);
    });

    it('returns true when salt exists', async () => {
      mockIDBStore.set(`rapid_db_salt_${TEST_INSTANCE_ID}`, [1, 2, 3]);
      const result = await keyManager.hasExistingKey();
      expect(result).toBe(true);
    });
  });

  describe('setupNewKey', () => {
    it('generates salt and derives key from password', async () => {
      const { generateSalt, deriveKeyFromPassword, exportKey } = await import(
        '@rapid/shared'
      );

      const key = await keyManager.setupNewKey('testpassword');

      expect(generateSalt).toHaveBeenCalled();
      expect(deriveKeyFromPassword).toHaveBeenCalledWith(
        'testpassword',
        expect.any(Uint8Array)
      );
      expect(exportKey).toHaveBeenCalled();
      expect(key).toBeInstanceOf(Uint8Array);
    });

    it('stores salt and KCV', async () => {
      await keyManager.setupNewKey('testpassword');

      // Check that salt was stored (with instance namespace)
      expect(mockIDBStore.has(`rapid_db_salt_${TEST_INSTANCE_ID}`)).toBe(true);
      // Check that KCV was stored (with instance namespace)
      expect(mockIDBStore.has(`rapid_db_kcv_${TEST_INSTANCE_ID}`)).toBe(true);
    });
  });

  describe('unlockWithPassword', () => {
    it('throws when no existing key (salt not found)', async () => {
      await expect(keyManager.unlockWithPassword('password')).rejects.toThrow(
        'No existing key found'
      );
    });

    it('returns key when password matches (KCV verification)', async () => {
      // Setup first
      await keyManager.setupNewKey('correct-password');

      // Create a new key manager to simulate fresh unlock
      const freshKeyManager = new KeyManager(TEST_INSTANCE_ID);
      const result =
        await freshKeyManager.unlockWithPassword('correct-password');

      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('changePassword', () => {
    it('returns old and new keys on successful change', async () => {
      await keyManager.setupNewKey('original-password');

      const freshKeyManager = new KeyManager(TEST_INSTANCE_ID);
      const result = await freshKeyManager.changePassword(
        'original-password',
        'new-password'
      );

      expect(result).not.toBeNull();
      expect(result?.oldKey).toBeInstanceOf(Uint8Array);
      expect(result?.newKey).toBeInstanceOf(Uint8Array);
    });
  });

  describe('getCurrentKey', () => {
    it('returns null before unlock', () => {
      expect(keyManager.getCurrentKey()).toBeNull();
    });

    it('returns key after setup', async () => {
      await keyManager.setupNewKey('password');
      expect(keyManager.getCurrentKey()).toBeInstanceOf(Uint8Array);
    });
  });

  describe('clearKey', () => {
    it('clears the current key from memory', async () => {
      const { secureZero } = await import('@rapid/shared');

      await keyManager.setupNewKey('password');
      expect(keyManager.getCurrentKey()).not.toBeNull();

      keyManager.clearKey();

      expect(keyManager.getCurrentKey()).toBeNull();
      expect(secureZero).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('clears key and storage', async () => {
      await keyManager.setupNewKey('password');
      await keyManager.persistSession();
      expect(mockIDBStore.size).toBeGreaterThan(0);

      await keyManager.reset();
      await flushTimers();

      expect(keyManager.getCurrentKey()).toBeNull();
      expect(mockIDBStore.size).toBe(0);
    });
  });

  describe('getInstanceId', () => {
    it('returns the instance ID', () => {
      expect(keyManager.getInstanceId()).toBe(TEST_INSTANCE_ID);
    });
  });

  describe('session persistence', () => {
    it('returns false for persistSession when no current key', async () => {
      const result = await keyManager.persistSession();
      expect(result).toBe(false);
    });

    it('persists a session on web', async () => {
      await keyManager.setupNewKey('password');

      const result = await keyManager.persistSession();
      await flushTimers();

      expect(result).toBe(true);
      expect(
        mockIDBStore.has(`rapid_session_wrapping_key_${TEST_INSTANCE_ID}`)
      ).toBe(true);
      expect(
        mockIDBStore.has(`rapid_session_wrapped_key_${TEST_INSTANCE_ID}`)
      ).toBe(true);
    });

    it('returns false for hasPersistedSession when no session stored', async () => {
      const result = await keyManager.hasPersistedSession();
      expect(result).toBe(false);
    });

    it('returns true for hasPersistedSession when web session exists', async () => {
      mockIDBStore.set(`rapid_session_wrapping_key_${TEST_INSTANCE_ID}`, {
        wrapping: true
      });
      mockIDBStore.set(`rapid_session_wrapped_key_${TEST_INSTANCE_ID}`, [1, 2]);

      const result = await keyManager.hasPersistedSession();

      expect(result).toBe(true);
    });

    it('returns null for restoreSession when no session stored', async () => {
      const result = await keyManager.restoreSession();
      expect(result).toBeNull();
    });

    it('clears session when restoreSession fails to unwrap', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const { unwrapKey } = await import('@rapid/shared');
      const unwrapMock = vi.mocked(unwrapKey);
      unwrapMock.mockRejectedValueOnce(new Error('unwrap failed'));

      mockIDBStore.set(`rapid_session_wrapping_key_${TEST_INSTANCE_ID}`, {
        wrapping: true
      });
      mockIDBStore.set(`rapid_session_wrapped_key_${TEST_INSTANCE_ID}`, [1, 2]);

      const result = await keyManager.restoreSession();
      await flushTimers();

      expect(result).toBeNull();
      expect(
        mockIDBStore.has(`rapid_session_wrapping_key_${TEST_INSTANCE_ID}`)
      ).toBe(false);
      expect(
        mockIDBStore.has(`rapid_session_wrapped_key_${TEST_INSTANCE_ID}`)
      ).toBe(false);
      consoleError.mockRestore();
    });

    it('clearPersistedSession clears stored session keys', async () => {
      mockIDBStore.set(`rapid_session_wrapping_key_${TEST_INSTANCE_ID}`, {
        wrapped: true
      });
      mockIDBStore.set(`rapid_session_wrapped_key_${TEST_INSTANCE_ID}`, [1, 2]);

      await keyManager.clearPersistedSession();
      await flushTimers();

      expect(
        mockIDBStore.has(`rapid_session_wrapping_key_${TEST_INSTANCE_ID}`)
      ).toBe(false);
      expect(
        mockIDBStore.has(`rapid_session_wrapped_key_${TEST_INSTANCE_ID}`)
      ).toBe(false);
    });
  });

  describe('web storage errors', () => {
    it('creates the object store during an IndexedDB upgrade', async () => {
      mockDB.objectStoreNames.contains.mockReturnValue(false);

      const upgradeManager = new KeyManager('upgrade-instance');
      await upgradeManager.hasExistingKey();

      expect(mockDB.createObjectStore).toHaveBeenCalledWith('keys');
      mockDB.objectStoreNames.contains.mockReturnValue(true);
    });

    it('skips object store creation when already present during upgrade', async () => {
      mockDB.createObjectStore.mockClear();
      mockDB.objectStoreNames.contains.mockReturnValue(true);

      const openMock = vi.mocked(indexedDB.open);
      openMock.mockImplementationOnce(() => {
        const request = createOpenRequest();
        setTimeout(() => {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        }, 0);
        return request;
      });

      const upgradeManager = new KeyManager('upgrade-existing');
      await upgradeManager.hasExistingKey();

      expect(mockDB.createObjectStore).not.toHaveBeenCalled();
    });

    it('rejects when IndexedDB open fails', async () => {
      const openMock = vi.mocked(indexedDB.open);
      openMock.mockImplementationOnce(() => {
        const request = createOpenRequest();
        request.error = new Error('open failed');
        setTimeout(() => request.onerror?.(), 0);
        return request;
      });

      await expect(keyManager.hasExistingKey()).rejects.toBeDefined();
    });

    it('rejects when IndexedDB get fails', async () => {
      const originalGet = mockObjectStore.get;
      mockObjectStore.get = vi.fn(() => {
        const request = mockIDBRequest(undefined);
        request.error = new Error('get failed');
        setTimeout(() => request.onerror?.(), 0);
        return request;
      });

      try {
        await expect(keyManager.hasExistingKey()).rejects.toBeDefined();
      } finally {
        mockObjectStore.get = originalGet;
      }
    });

    it('rejects when IndexedDB put fails', async () => {
      const originalPut = mockObjectStore.put;
      mockObjectStore.put = vi.fn(() => {
        const request = mockIDBRequest(undefined);
        request.error = new Error('put failed');
        setTimeout(() => request.onerror?.(), 0);
        return request;
      });

      try {
        await expect(keyManager.setupNewKey('password')).rejects.toBeDefined();
      } finally {
        mockObjectStore.put = originalPut;
      }
    });

    it('rejects when IndexedDB delete fails', async () => {
      const originalDelete = mockObjectStore.delete;
      mockObjectStore.delete = vi.fn(() => {
        const request = mockIDBRequest(undefined);
        request.error = new Error('delete failed');
        setTimeout(() => request.onerror?.(), 0);
        return request;
      });

      try {
        await expect(keyManager.clearPersistedSession()).rejects.toBeDefined();
      } finally {
        mockObjectStore.delete = originalDelete;
      }
    });
  });

  describe('changePassword error cases', () => {
    it('returns null when old password is incorrect', async () => {
      await keyManager.setupNewKey('correct-password');

      // Create a fresh key manager and try to change password with wrong old password
      const freshKeyManager = new KeyManager(TEST_INSTANCE_ID);

      const result = await freshKeyManager.changePassword(
        'wrong-password',
        'new-password'
      );

      expect(result).toBeNull();
    });
  });

  describe('initialize behavior', () => {
    it('auto-initializes storage on hasExistingKey', async () => {
      // Create a new key manager that hasn't been initialized
      const freshKeyManager = new KeyManager('fresh-instance');

      // This should auto-initialize storage
      const result = await freshKeyManager.hasExistingKey();

      expect(result).toBe(false);
    });

    it('auto-initializes storage on setupNewKey', async () => {
      const freshKeyManager = new KeyManager('fresh-instance-2');

      const key = await freshKeyManager.setupNewKey('password');

      expect(key).toBeInstanceOf(Uint8Array);
    });
  });
});

describe('key manager module functions', () => {
  beforeEach(() => {
    clearAllKeyManagers();
  });

  describe('getKeyManagerForInstance', () => {
    it('returns a KeyManager for the specified instance', () => {
      const manager = getKeyManagerForInstance('test-1');
      expect(manager).toBeDefined();
      expect(manager.getInstanceId()).toBe('test-1');
    });

    it('returns the same instance for the same ID', () => {
      const manager1 = getKeyManagerForInstance('test-1');
      const manager2 = getKeyManagerForInstance('test-1');
      expect(manager1).toBe(manager2);
    });

    it('returns different instances for different IDs', () => {
      const manager1 = getKeyManagerForInstance('test-1');
      const manager2 = getKeyManagerForInstance('test-2');
      expect(manager1).not.toBe(manager2);
    });
  });

  describe('setCurrentInstanceId and getCurrentInstanceId', () => {
    it('sets and gets the current instance ID', () => {
      setCurrentInstanceId('active-instance');
      expect(getCurrentInstanceId()).toBe('active-instance');
    });

    it('can set to null', () => {
      setCurrentInstanceId('active-instance');
      setCurrentInstanceId(null);
      expect(getCurrentInstanceId()).toBeNull();
    });
  });

  describe('getKeyManager', () => {
    it('throws when no current instance is set', () => {
      expect(() => getKeyManager()).toThrow('No active instance');
    });

    it('returns manager for current instance', () => {
      setCurrentInstanceId('current-instance');
      const manager = getKeyManager();
      expect(manager.getInstanceId()).toBe('current-instance');
    });
  });

  describe('clearKeyManagerForInstance', () => {
    it('clears the specific instance', async () => {
      const manager = getKeyManagerForInstance('to-clear');
      await manager.setupNewKey('password');

      clearKeyManagerForInstance('to-clear');

      // Getting the manager again should create a new one
      const newManager = getKeyManagerForInstance('to-clear');
      expect(newManager.getCurrentKey()).toBeNull();
    });

    it('does not clear other instances', async () => {
      const manager1 = getKeyManagerForInstance('keep');
      const manager2 = getKeyManagerForInstance('clear');

      await manager1.setupNewKey('password1');
      await manager2.setupNewKey('password2');

      clearKeyManagerForInstance('clear');

      // manager1 should still have its key
      expect(manager1.getCurrentKey()).not.toBeNull();
    });

    it('does nothing when instance does not exist', () => {
      clearKeyManagerForInstance('missing-instance');
      expect(getCurrentInstanceId()).toBeNull();
    });
  });

  describe('clearAllKeyManagers', () => {
    it('clears all instances', async () => {
      const manager1 = getKeyManagerForInstance('instance-1');
      const manager2 = getKeyManagerForInstance('instance-2');

      await manager1.setupNewKey('password1');
      await manager2.setupNewKey('password2');
      setCurrentInstanceId('instance-1');

      clearAllKeyManagers();

      expect(getCurrentInstanceId()).toBeNull();
      // Getting managers again should create new ones
      const newManager1 = getKeyManagerForInstance('instance-1');
      const newManager2 = getKeyManagerForInstance('instance-2');
      expect(newManager1.getCurrentKey()).toBeNull();
      expect(newManager2.getCurrentKey()).toBeNull();
    });
  });
});

describe('ElectronKeyStorage session persistence', () => {
  const ELECTRON_INSTANCE_ID = 'electron-test-instance';

  // Mock Electron API
  const mockElectronApi = {
    getSalt: vi.fn(),
    setSalt: vi.fn(),
    getKeyCheckValue: vi.fn(),
    setKeyCheckValue: vi.fn(),
    clearKeyStorage: vi.fn(),
    getWrappingKey: vi.fn(),
    setWrappingKey: vi.fn(),
    getWrappedKey: vi.fn(),
    setWrappedKey: vi.fn(),
    hasSession: vi.fn(),
    clearSession: vi.fn()
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    clearAllKeyManagers();

    // Reset all mock return values
    mockElectronApi.getSalt.mockResolvedValue(null);
    mockElectronApi.getKeyCheckValue.mockResolvedValue(null);
    mockElectronApi.getWrappingKey.mockResolvedValue(null);
    mockElectronApi.getWrappedKey.mockResolvedValue(null);
    mockElectronApi.hasSession.mockResolvedValue(false);

    // Set up window.electron.sqlite mock
    (
      window as unknown as { electron: { sqlite: typeof mockElectronApi } }
    ).electron = {
      sqlite: mockElectronApi
    };

    // Mock detectPlatform to return 'electron'
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('electron');
  });

  afterEach(() => {
    // Clean up window.electron
    delete (window as unknown as { electron?: unknown }).electron;
  });

  describe('hasPersistedSession', () => {
    it('returns false when no session exists', async () => {
      mockElectronApi.hasSession.mockResolvedValue(false);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.hasPersistedSession();

      expect(result).toBe(false);
      expect(mockElectronApi.hasSession).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });

    it('returns true when session exists', async () => {
      mockElectronApi.hasSession.mockResolvedValue(true);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.hasPersistedSession();

      expect(result).toBe(true);
      expect(mockElectronApi.hasSession).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });
  });

  describe('persistSession', () => {
    it('stores wrapping key and wrapped key via IPC', async () => {
      mockElectronApi.getSalt.mockResolvedValue([1, 2, 3]);
      mockElectronApi.getKeyCheckValue.mockResolvedValue('test-kcv');

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      await keyManager.setupNewKey('password');

      const result = await keyManager.persistSession();

      expect(result).toBe(true);
      expect(mockElectronApi.setWrappingKey).toHaveBeenCalledWith(
        expect.any(Array),
        ELECTRON_INSTANCE_ID
      );
      expect(mockElectronApi.setWrappedKey).toHaveBeenCalledWith(
        expect.any(Array),
        ELECTRON_INSTANCE_ID
      );
    });

    it('returns false when no current key', async () => {
      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.persistSession();

      expect(result).toBe(false);
      expect(mockElectronApi.setWrappingKey).not.toHaveBeenCalled();
    });

    it('returns false when Electron storage throws', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      mockElectronApi.setWrappingKey.mockRejectedValueOnce(
        new Error('ipc failed')
      );

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      await keyManager.setupNewKey('password');

      const result = await keyManager.persistSession();

      expect(result).toBe(false);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('restoreSession', () => {
    it('retrieves and unwraps the session key', async () => {
      mockElectronApi.getWrappingKey.mockResolvedValue([4, 4, 4]);
      mockElectronApi.getWrappedKey.mockResolvedValue([3, 3, 3]);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockElectronApi.getWrappingKey).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
      expect(mockElectronApi.getWrappedKey).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });

    it('returns null when no session stored', async () => {
      mockElectronApi.getWrappingKey.mockResolvedValue(null);
      mockElectronApi.getWrappedKey.mockResolvedValue(null);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeNull();
    });

    it('returns null when wrapping key retrieval fails', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      mockElectronApi.getWrappingKey.mockRejectedValueOnce(
        new Error('wrapping key failed')
      );
      mockElectronApi.getWrappedKey.mockResolvedValue([1, 2, 3]);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('returns null when wrapped key retrieval fails', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      mockElectronApi.getWrappingKey.mockResolvedValue([1, 2, 3]);
      mockElectronApi.getWrappedKey.mockRejectedValueOnce(
        new Error('wrapped key failed')
      );

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('clearPersistedSession', () => {
    it('clears session data via IPC', async () => {
      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      await keyManager.clearPersistedSession();

      expect(mockElectronApi.clearSession).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });
  });
});

describe('ElectronKeyStorage adapter behavior', () => {
  const ELECTRON_STATUS_ID = 'electron-status';

  beforeEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('electron');
  });

  afterEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns key status using Electron storage', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getSalt: vi.fn(async () => [1, 2, 3]),
          getKeyCheckValue: vi.fn(async () => 'kcv'),
          hasSession: vi.fn(async () => true)
        }
      },
      configurable: true
    });

    const result = await getKeyStatusForInstance(ELECTRON_STATUS_ID);

    expect(result).toEqual({
      salt: true,
      keyCheckValue: true,
      wrappingKey: true,
      wrappedKey: true
    });
  });

  it('returns false for missing Electron salt and key check value', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getSalt: vi.fn(async () => null),
          getKeyCheckValue: vi.fn(async () => null),
          hasSession: vi.fn(async () => false)
        }
      },
      configurable: true
    });

    const result = await getKeyStatusForInstance('electron-null-salt');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });
  });

  it('skips salt and KCV IPC when Electron APIs are missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: { sqlite: {} },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-salt-kcv');
    const result = await keyManager.setupNewKey('password');

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('returns empty status when Electron storage APIs are missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: { sqlite: {} },
      configurable: true
    });

    const result = await getKeyStatusForInstance('electron-missing');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });
  });

  it('handles missing Electron session IPC methods gracefully', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          setSalt: vi.fn(async () => undefined),
          setKeyCheckValue: vi.fn(async () => undefined)
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-session');
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
  });

  it('returns null when Electron wrapped key API is missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getWrappingKey: vi.fn(async () => [1, 2, 3])
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-wrapped');
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('skips clearing Electron session when IPC is missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {}
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-clear');
    await keyManager.clearPersistedSession();

    expect(true).toBe(true);
  });

  it('skips clearing key storage when Electron IPC is missing', async () => {
    const clearSession = vi.fn(async () => undefined);
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          clearSession
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-no-clear-storage');
    await keyManager.reset();

    expect(clearSession).toHaveBeenCalledWith('electron-no-clear-storage');
  });

  it('returns null when Electron wrapping key API is missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getWrappedKey: vi.fn(async () => [1, 2, 3])
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-wrapping');
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('initializes and clears Electron storage on reset', async () => {
    const clearKeyStorage = vi.fn(async () => undefined);
    const clearSession = vi.fn(async () => undefined);

    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          clearKeyStorage,
          clearSession
        }
      },
      configurable: true
    });

    const manager = new KeyManager('electron-reset');
    await manager.reset();

    expect(clearKeyStorage).toHaveBeenCalledWith('electron-reset');
    expect(clearSession).toHaveBeenCalledWith('electron-reset');
  });
});

describe('CapacitorKeyStorage session persistence', () => {
  const IOS_INSTANCE_ID = 'ios-test-instance';

  beforeEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
  });

  afterEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns false when wrapping key storage fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(nativeStorage.storeWrappingKeyBytes).mockResolvedValueOnce(false);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(false);
    consoleError.mockRestore();
  });

  it('returns false when wrapped key storage fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(nativeStorage.storeWrappingKeyBytes).mockResolvedValueOnce(true);
    vi.mocked(nativeStorage.storeWrappedKey).mockResolvedValueOnce(false);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(false);
    consoleError.mockRestore();
  });

  it('returns null when wrapping key retrieval throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(nativeStorage.retrieveWrappingKeyBytes).mockRejectedValueOnce(
      new Error('wrapping key failed')
    );
    vi.mocked(nativeStorage.retrieveWrappedKey).mockResolvedValueOnce(
      new Uint8Array([1, 2, 3])
    );

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns null when wrapped key retrieval throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(nativeStorage.retrieveWrappingKeyBytes).mockResolvedValueOnce(
      new Uint8Array([1, 2, 3])
    );
    vi.mocked(nativeStorage.retrieveWrappedKey).mockImplementationOnce(() => {
      throw new Error('wrapped key failed');
    });

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns null when wrapping key is missing', async () => {
    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(nativeStorage.retrieveWrappingKeyBytes).mockResolvedValueOnce(null);
    vi.mocked(nativeStorage.retrieveWrappedKey).mockResolvedValueOnce(
      new Uint8Array([1, 2, 3])
    );

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('clears native session data on clearPersistedSession', async () => {
    const nativeStorage = await import('./native-secure-storage');

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.clearPersistedSession();

    expect(nativeStorage.clearSession).toHaveBeenCalledWith(IOS_INSTANCE_ID);
  });

  it('persists session when native storage succeeds', async () => {
    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(nativeStorage.storeWrappingKeyBytes).mockResolvedValueOnce(true);
    vi.mocked(nativeStorage.storeWrappedKey).mockResolvedValueOnce(true);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
  });
});

describe('platform session checks', () => {
  it('initializes storage when persisting without prior setup', async () => {
    const keyManager = new KeyManager('persist-init');

    Object.defineProperty(keyManager, 'currentKey', {
      value: new Uint8Array([1, 2, 3]),
      writable: true
    });
    Object.defineProperty(keyManager, 'storage', {
      value: null,
      writable: true
    });

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
  });

  it('uses existing storage when checking for a key', async () => {
    const keyManager = new KeyManager('repeat-has-key');
    await keyManager.hasExistingKey();
    const result = await keyManager.hasExistingKey();

    expect(result).toBe(false);
  });

  it('uses existing storage when setting up a key', async () => {
    const keyManager = new KeyManager('repeat-setup');
    await keyManager.setupNewKey('password');
    const result = await keyManager.setupNewKey('password');

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses existing storage when unlocking a key', async () => {
    const keyManager = new KeyManager('repeat-unlock');
    await keyManager.setupNewKey('password');
    keyManager.clearKey();

    const result = await keyManager.unlockWithPassword('password');

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses existing storage when checking persisted session', async () => {
    const keyManager = new KeyManager('repeat-session-check');
    await keyManager.setupNewKey('password');

    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(false);
  });

  it('uses existing storage when restoring a session', async () => {
    const keyManager = new KeyManager('repeat-restore');
    await keyManager.setupNewKey('password');

    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('delegates hasPersistedSession to native storage on iOS', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./native-secure-storage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(nativeStorage.hasSession).mockResolvedValueOnce(true);

    const keyManager = new KeyManager('ios-has-session');
    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(true);
    expect(nativeStorage.hasSession).toHaveBeenCalledWith('ios-has-session');

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns false on Electron when IPC is unavailable', async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('electron');

    Object.defineProperty(window, 'electron', {
      value: undefined,
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-ipc');
    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(false);

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('uses native session check for key status on iOS', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./native-secure-storage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(nativeStorage.hasSession).mockResolvedValueOnce(false);

    const result = await getKeyStatusForInstance('ios-status');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });
});

describe('isBiometricAvailable', () => {
  it('returns false on non-mobile platforms', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./native-secure-storage');

    vi.mocked(utils.detectPlatform).mockReturnValue('web');

    const result = await isBiometricAvailable();

    expect(result).toEqual({ isAvailable: false });
    expect(nativeStorage.isBiometricAvailable).not.toHaveBeenCalled();
  });

  it('returns native biometric availability on iOS', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./native-secure-storage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(nativeStorage.isBiometricAvailable).mockResolvedValueOnce({
      isAvailable: true
    });

    const result = await isBiometricAvailable();

    expect(result).toEqual({ isAvailable: true });
    expect(nativeStorage.isBiometricAvailable).toHaveBeenCalled();

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });
});

// Skip: These tests require complex mock coordination for multiple
// parallel IndexedDB operations through the storage adapter layer.
// The underlying storage methods (getSalt, getKeyCheckValue, hasSessionKeys,
// clearSession) are tested through the KeyManager class tests above.
describe('getKeyStatusForInstance', () => {
  beforeEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns all false when no keys exist', async () => {
    const result = await getKeyStatusForInstance('missing-instance');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });
  });

  it('returns true for existing keys', async () => {
    const instanceId = 'status-instance';

    mockIDBStore.set(`rapid_db_salt_${instanceId}`, [1, 2, 3]);
    mockIDBStore.set(`rapid_db_kcv_${instanceId}`, 'kcv');

    const result = await getKeyStatusForInstance(instanceId);

    expect(result).toEqual({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });
  });

  it('returns true for session keys when present', async () => {
    const instanceId = 'session-instance';

    mockIDBStore.set(`rapid_db_salt_${instanceId}`, [1, 2, 3]);
    mockIDBStore.set(`rapid_db_kcv_${instanceId}`, 'kcv');
    mockIDBStore.set(`rapid_session_wrapping_key_${instanceId}`, {
      wrapping: true
    });
    mockIDBStore.set(`rapid_session_wrapped_key_${instanceId}`, [1, 2, 3]);

    const result = await getKeyStatusForInstance(instanceId);

    expect(result).toEqual({
      salt: true,
      keyCheckValue: true,
      wrappingKey: true,
      wrappedKey: true
    });
  });
});

describe('deleteSessionKeysForInstance', () => {
  beforeEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('deletes session keys but preserves salt and KCV', async () => {
    const instanceId = 'delete-session';

    mockIDBStore.set(`rapid_db_salt_${instanceId}`, [1, 2, 3]);
    mockIDBStore.set(`rapid_db_kcv_${instanceId}`, 'kcv');
    mockIDBStore.set(`rapid_session_wrapping_key_${instanceId}`, {
      wrapping: true
    });
    mockIDBStore.set(`rapid_session_wrapped_key_${instanceId}`, [1, 2, 3]);

    await deleteSessionKeysForInstance(instanceId);
    await flushTimers();

    expect(mockIDBStore.has(`rapid_db_salt_${instanceId}`)).toBe(true);
    expect(mockIDBStore.has(`rapid_db_kcv_${instanceId}`)).toBe(true);
    expect(mockIDBStore.has(`rapid_session_wrapping_key_${instanceId}`)).toBe(
      false
    );
    expect(mockIDBStore.has(`rapid_session_wrapped_key_${instanceId}`)).toBe(
      false
    );
  });

  it('completes successfully when no session keys exist', async () => {
    await expect(
      deleteSessionKeysForInstance('missing-session')
    ).resolves.toBeUndefined();
  });
});

describe('validateAndPruneOrphanedInstances', () => {
  beforeEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  // Note: Full integration tests are in the Maestro test orphan-cleanup.yaml

  it('returns empty result when called with empty registry', async () => {
    const { validateAndPruneOrphanedInstances } = await import('./key-manager');

    const result = await validateAndPruneOrphanedInstances([], vi.fn());

    expect(result).toEqual({
      orphanedKeystoreEntries: [],
      orphanedRegistryEntries: [],
      cleaned: false
    });
  });

  it('returns empty result when indexedDB is undefined (test environment)', async () => {
    // Save original indexedDB
    const originalIndexedDB = globalThis.indexedDB;

    // Remove indexedDB to simulate test environment
    // @ts-expect-error - intentionally setting to undefined for test
    delete globalThis.indexedDB;

    try {
      // Re-import to get fresh module
      vi.resetModules();
      const { validateAndPruneOrphanedInstances } = await import(
        './key-manager'
      );

      const mockDelete = vi.fn();
      const result = await validateAndPruneOrphanedInstances(
        ['instance-1', 'instance-2'],
        mockDelete
      );

      // Should return early without processing
      expect(result).toEqual({
        orphanedKeystoreEntries: [],
        orphanedRegistryEntries: [],
        cleaned: false
      });
      expect(mockDelete).not.toHaveBeenCalled();
    } finally {
      // Restore indexedDB
      globalThis.indexedDB = originalIndexedDB;
      vi.resetModules();
    }
  });

  it('detects and cleans orphaned registry entries', async () => {
    const registryIds = ['valid-instance', 'orphan-instance'];
    const deleteRegistryEntry = vi.fn(async () => undefined);

    mockIDBStore.set(`rapid_db_salt_valid-instance`, [1, 2, 3]);
    mockIDBStore.set(`rapid_db_kcv_valid-instance`, 'kcv');
    mockIDBStore.set(`rapid_db_salt_orphan-instance`, [1, 2, 3]);

    const result = await validateAndPruneOrphanedInstances(
      registryIds,
      deleteRegistryEntry
    );
    await flushTimers();

    expect(result.orphanedRegistryEntries).toEqual(['orphan-instance']);
    expect(result.cleaned).toBe(true);
    expect(deleteRegistryEntry).toHaveBeenCalledWith('orphan-instance');
    expect(mockIDBStore.has('rapid_db_salt_orphan-instance')).toBe(false);
  });

  it('detects and cleans orphaned Keystore entries on mobile', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(utils.detectPlatform).mockReturnValue('ios');

    vi.mocked(nativeStorage.getTrackedKeystoreInstanceIds).mockResolvedValue([
      'keystore-orphan',
      'keystore-keep'
    ]);

    const result = await validateAndPruneOrphanedInstances(
      ['keystore-keep'],
      vi.fn()
    );

    expect(result.orphanedKeystoreEntries).toEqual(['keystore-orphan']);
    expect(result.cleaned).toBe(true);
    expect(nativeStorage.clearSession).toHaveBeenCalledWith('keystore-orphan');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns empty result when orphan cleanup throws', async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./native-secure-storage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(nativeStorage.getTrackedKeystoreInstanceIds).mockRejectedValueOnce(
      new Error('cleanup failed')
    );

    const result = await validateAndPruneOrphanedInstances(['id-1'], vi.fn());

    expect(result).toEqual({
      orphanedKeystoreEntries: [],
      orphanedRegistryEntries: [],
      cleaned: false
    });
    expect(consoleWarn).toHaveBeenCalled();

    consoleWarn.mockRestore();
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('skips clearing keystore entries when none are orphaned', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./native-secure-storage');
    vi.mocked(utils.detectPlatform).mockReturnValue('ios');

    vi.mocked(nativeStorage.getTrackedKeystoreInstanceIds).mockResolvedValue([
      'keystore-keep'
    ]);

    const result = await validateAndPruneOrphanedInstances(
      ['keystore-keep'],
      vi.fn()
    );

    expect(result.orphanedKeystoreEntries).toEqual([]);
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });
});
