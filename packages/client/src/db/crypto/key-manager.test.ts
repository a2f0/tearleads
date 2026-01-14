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

    it('returns false for hasPersistedSession when no session stored', async () => {
      const result = await keyManager.hasPersistedSession();
      expect(result).toBe(false);
    });

    it('returns null for restoreSession when no session stored', async () => {
      const result = await keyManager.restoreSession();
      expect(result).toBeNull();
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
});
