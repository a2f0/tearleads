/**
 * KeyManager module functions tests (getKeyManager, setCurrentInstanceId, etc.).
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
  clearKeyManagerForInstance,
  getCurrentInstanceId,
  getKeyManager,
  getKeyManagerForInstance,
  setCurrentInstanceId
} from './keyManager';
import { mockDB, mockIDBStore, resetKeyBytesMap } from './keyManager.testUtils';

describe('key manager module functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
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
