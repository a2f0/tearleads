/**
 * KeyManager class unit tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock() calls must be in each test file (hoisted)
vi.mock('@tearleads/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tearleads/shared')>();
  const { createSharedMock } = await import('./keyManager.testUtils');
  return { ...original, ...createSharedMock() };
});

vi.mock('./nativeSecureStorage', async () => {
  const { createNativeStorageMock } = await import('./keyManager.testUtils');
  return createNativeStorageMock();
});

vi.mock('@/lib/utils', async () => {
  const { createUtilsMock } = await import('./keyManager.testUtils');
  return createUtilsMock();
});

import { KeyManager } from './keyManager';
import {
  createOpenRequest,
  flushTimers,
  indexedDbOpenMock,
  mockDB,
  mockIDBRequest,
  mockIDBStore,
  mockObjectStore,
  resetKeyBytesMap,
  TEST_INSTANCE_ID
} from './keyManager.testUtils';

describe('KeyManager', () => {
  let keyManager: KeyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    keyManager = new KeyManager(TEST_INSTANCE_ID);
  });

  describe('hasExistingKey', () => {
    it('returns false when no salt is stored', async () => {
      const result = await keyManager.hasExistingKey();
      expect(result).toBe(false);
    });

    it('returns true when salt exists', async () => {
      mockIDBStore.set(`tearleads_db_salt_${TEST_INSTANCE_ID}`, [1, 2, 3]);
      const result = await keyManager.hasExistingKey();
      expect(result).toBe(true);
    });
  });

  describe('setupNewKey', () => {
    it('generates salt and derives key from password', async () => {
      const { generateSalt, deriveKeyFromPassword, exportKey } = await import(
        '@tearleads/shared'
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
      expect(mockIDBStore.has(`tearleads_db_salt_${TEST_INSTANCE_ID}`)).toBe(
        true
      );
      // Check that KCV was stored (with instance namespace)
      expect(mockIDBStore.has(`tearleads_db_kcv_${TEST_INSTANCE_ID}`)).toBe(
        true
      );
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

    it('returns null when old password is incorrect', async () => {
      await keyManager.setupNewKey('correct-password');

      const freshKeyManager = new KeyManager(TEST_INSTANCE_ID);
      const result = await freshKeyManager.changePassword(
        'wrong-password',
        'new-password'
      );

      expect(result).toBeNull();
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
      const { secureZero } = await import('@tearleads/shared');

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
        mockIDBStore.has(`tearleads_session_wrapping_key_${TEST_INSTANCE_ID}`)
      ).toBe(true);
      expect(
        mockIDBStore.has(`tearleads_session_wrapped_key_${TEST_INSTANCE_ID}`)
      ).toBe(true);
    });

    it('returns false for hasPersistedSession when no session stored', async () => {
      const result = await keyManager.hasPersistedSession();
      expect(result).toBe(false);
    });

    it('returns true for hasPersistedSession when web session exists', async () => {
      mockIDBStore.set(`tearleads_session_wrapping_key_${TEST_INSTANCE_ID}`, {
        wrapping: true
      });
      mockIDBStore.set(
        `tearleads_session_wrapped_key_${TEST_INSTANCE_ID}`,
        [1, 2]
      );

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

      const { unwrapKey } = await import('@tearleads/shared');
      const unwrapMock = vi.mocked(unwrapKey);
      unwrapMock.mockRejectedValueOnce(new Error('unwrap failed'));

      mockIDBStore.set(`tearleads_session_wrapping_key_${TEST_INSTANCE_ID}`, {
        wrapping: true
      });
      mockIDBStore.set(
        `tearleads_session_wrapped_key_${TEST_INSTANCE_ID}`,
        [1, 2]
      );

      const result = await keyManager.restoreSession();
      await flushTimers();

      expect(result).toBeNull();
      expect(
        mockIDBStore.has(`tearleads_session_wrapping_key_${TEST_INSTANCE_ID}`)
      ).toBe(false);
      expect(
        mockIDBStore.has(`tearleads_session_wrapped_key_${TEST_INSTANCE_ID}`)
      ).toBe(false);
      consoleError.mockRestore();
    });

    it('clearPersistedSession clears stored session keys', async () => {
      mockIDBStore.set(`tearleads_session_wrapping_key_${TEST_INSTANCE_ID}`, {
        wrapped: true
      });
      mockIDBStore.set(
        `tearleads_session_wrapped_key_${TEST_INSTANCE_ID}`,
        [1, 2]
      );

      await keyManager.clearPersistedSession();
      await flushTimers();

      expect(
        mockIDBStore.has(`tearleads_session_wrapping_key_${TEST_INSTANCE_ID}`)
      ).toBe(false);
      expect(
        mockIDBStore.has(`tearleads_session_wrapped_key_${TEST_INSTANCE_ID}`)
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

      indexedDbOpenMock.mockImplementationOnce(() => {
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
      indexedDbOpenMock.mockImplementationOnce(() => {
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

  describe('initialize behavior', () => {
    it('auto-initializes storage on hasExistingKey', async () => {
      const freshKeyManager = new KeyManager('fresh-instance');
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
