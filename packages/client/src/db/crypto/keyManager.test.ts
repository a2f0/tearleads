/**
 * KeyManager utility functions tests (getKeyStatusForInstance,
 * deleteSessionKeysForInstance, validateAndPruneOrphanedInstances).
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

import {
  clearAllKeyManagers,
  deleteSessionKeysForInstance,
  getKeyStatusForInstance,
  validateAndPruneOrphanedInstances
} from './keyManager';
import {
  flushTimers,
  mockDB,
  mockIDBStore,
  resetKeyBytesMap
} from './keyManager.testUtils';

describe('getKeyStatusForInstance', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();

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

    mockIDBStore.set(`tearleads_db_salt_${instanceId}`, [1, 2, 3]);
    mockIDBStore.set(`tearleads_db_kcv_${instanceId}`, 'kcv');

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

    mockIDBStore.set(`tearleads_db_salt_${instanceId}`, [1, 2, 3]);
    mockIDBStore.set(`tearleads_db_kcv_${instanceId}`, 'kcv');
    mockIDBStore.set(`tearleads_session_wrapping_key_${instanceId}`, {
      wrapping: true
    });
    mockIDBStore.set(`tearleads_session_wrapped_key_${instanceId}`, [1, 2, 3]);

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
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();

    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('deletes session keys but preserves salt and KCV', async () => {
    const instanceId = 'delete-session';

    mockIDBStore.set(`tearleads_db_salt_${instanceId}`, [1, 2, 3]);
    mockIDBStore.set(`tearleads_db_kcv_${instanceId}`, 'kcv');
    mockIDBStore.set(`tearleads_session_wrapping_key_${instanceId}`, {
      wrapping: true
    });
    mockIDBStore.set(`tearleads_session_wrapped_key_${instanceId}`, [1, 2, 3]);

    await deleteSessionKeysForInstance(instanceId);
    await flushTimers();

    expect(mockIDBStore.has(`tearleads_db_salt_${instanceId}`)).toBe(true);
    expect(mockIDBStore.has(`tearleads_db_kcv_${instanceId}`)).toBe(true);
    expect(
      mockIDBStore.has(`tearleads_session_wrapping_key_${instanceId}`)
    ).toBe(false);
    expect(
      mockIDBStore.has(`tearleads_session_wrapped_key_${instanceId}`)
    ).toBe(false);
  });

  it('completes successfully when no session keys exist', async () => {
    await expect(
      deleteSessionKeysForInstance('missing-session')
    ).resolves.toBeUndefined();
  });
});

describe('validateAndPruneOrphanedInstances', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();

    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns empty result when called with empty registry', async () => {
    const { validateAndPruneOrphanedInstances } = await import('./keyManager');

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
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: undefined,
      writable: true
    });

    try {
      // Re-import to get fresh module
      vi.resetModules();
      const { validateAndPruneOrphanedInstances } = await import(
        './keyManager'
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
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: originalIndexedDB,
        writable: true
      });
      vi.resetModules();
    }
  });

  it('detects and cleans orphaned registry entries', async () => {
    const registryIds = ['valid-instance', 'orphan-instance'];
    const deleteRegistryEntry = vi.fn(async () => undefined);

    mockIDBStore.set(`tearleads_db_salt_valid-instance`, [1, 2, 3]);
    mockIDBStore.set(`tearleads_db_kcv_valid-instance`, 'kcv');
    mockIDBStore.set(`tearleads_db_salt_orphan-instance`, [1, 2, 3]);

    const result = await validateAndPruneOrphanedInstances(
      registryIds,
      deleteRegistryEntry
    );
    await flushTimers();

    expect(result.orphanedRegistryEntries).toEqual(['orphan-instance']);
    expect(result.cleaned).toBe(true);
    expect(deleteRegistryEntry).toHaveBeenCalledWith('orphan-instance');
    expect(mockIDBStore.has('tearleads_db_salt_orphan-instance')).toBe(false);
  });

  it('detects and cleans orphaned Keystore entries on mobile', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./nativeSecureStorage');
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
    const nativeStorage = await import('./nativeSecureStorage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(
      nativeStorage.getTrackedKeystoreInstanceIds
    ).mockRejectedValueOnce(new Error('cleanup failed'));

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
    const nativeStorage = await import('./nativeSecureStorage');
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
