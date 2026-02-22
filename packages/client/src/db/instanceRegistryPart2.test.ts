/**
 * Tests for the instance registry.
 *
 * AGENT GUARDRAIL: Do NOT skip any tests in this file.
 * Instance switching tests are critical for verifying data isolation between instances.
 * If tests fail, fix the root cause rather than skipping.
 */

import { isRecord } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTestInstanceId,
  isTestInstance,
  isTestMode
} from '@/lib/testInstance';
import type { InstanceMetadata } from './instanceRegistry';
import {
  clearRegistry,
  createInstance,
  deleteInstanceFromRegistry,
  getActiveInstance,
  getActiveInstanceId,
  getInstance,
  getInstances,
  getRegistryData,
  initializeRegistry,
  resetInitializationState,
  setActiveInstanceId,
  touchInstance,
  updateInstance
} from './instanceRegistry';

vi.mock('@/lib/testInstance', () => ({
  getTestInstanceId: vi.fn(),
  isTestInstance: vi.fn(),
  isTestMode: vi.fn()
}));

const mockIsTestMode = vi.mocked(isTestMode);
const mockGetTestInstanceId = vi.mocked(getTestInstanceId);
const mockIsTestInstance = vi.mocked(isTestInstance);

// Mock IndexedDB
type StoreValue =
  | Array<InstanceMetadata | null | undefined>
  | string
  | null
  | undefined;
type MockRequest = {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

const mockStore = new Map<string, StoreValue>();
const mockIDBRequest = (result: unknown): MockRequest => ({
  result,
  error: null,
  onsuccess: null,
  onerror: null
});

const mockObjectStore = {
  get: vi.fn((key: string) => {
    const req = mockIDBRequest(mockStore.get(key));
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  put: vi.fn((value: StoreValue, key: string) => {
    mockStore.set(key, value);
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  delete: vi.fn((key: string) => {
    mockStore.delete(key);
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  clear: vi.fn(() => {
    mockStore.clear();
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  })
};

function createMockTransaction() {
  const objectStore = vi.fn(() => mockObjectStore);
  const tx: {
    objectStore: typeof objectStore;
    oncomplete: (() => void) | null;
  } = {
    objectStore,
    oncomplete: null
  };
  setTimeout(() => tx.oncomplete?.(), 10);
  return tx;
}

const mockDB = {
  transaction: vi.fn(() => createMockTransaction()),
  close: vi.fn(),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn()
};

type MockOpenRequest = {
  result: typeof mockDB;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
};

const createMockOpenRequest = (): MockOpenRequest => ({
  result: mockDB,
  error: null,
  onsuccess: null,
  onerror: null,
  onupgradeneeded: null
});

function isInstanceMetadata(value: unknown): value is InstanceMetadata {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['createdAt'] === 'number' &&
    typeof value['lastAccessedAt'] === 'number'
  );
}

function getStoredInstances(): InstanceMetadata[] {
  const value = mockStore.get('instances');
  if (!Array.isArray(value) || !value.every(isInstanceMetadata)) {
    return [];
  }
  return value;
}

vi.stubGlobal('indexedDB', {
  open: vi.fn(() => {
    const request = createMockOpenRequest();
    setTimeout(() => request.onsuccess?.(), 0);
    return request;
  }),
  deleteDatabase: vi.fn(() => {
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  })
});

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-1234')
});describe('instance-registry', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
    resetInitializationState();
    mockIsTestMode.mockReturnValue(false);
    mockGetTestInstanceId.mockReturnValue(null);
  });

  describe('initializeRegistry', () => {
    it('creates first instance when registry is empty', async () => {
      const instance = await initializeRegistry();

      expect(instance.name).toBe('Instance 1');
    });

    it('returns active instance when set', async () => {
      const existing = {
        id: 'existing',
        name: 'Instance 1',
        createdAt: 1000,
        lastAccessedAt: 2000
      };
      mockStore.set('instances', [existing]);
      mockStore.set('active_instance', 'existing');

      const instance = await initializeRegistry();

      expect(instance.id).toBe('existing');
    });

    it('uses first instance when active not found', async () => {
      const existing = {
        id: 'first',
        name: 'Instance 1',
        createdAt: 1000,
        lastAccessedAt: 2000
      };
      mockStore.set('instances', [existing]);
      mockStore.set('active_instance', 'nonexistent');

      const instance = await initializeRegistry();

      expect(instance.id).toBe('first');
    });

    it('throws when registry data is corrupted', async () => {
      mockStore.set('instances', [null]);
      mockStore.set('active_instance', 'nonexistent');

      await expect(initializeRegistry()).rejects.toThrow();
    });

    it('overrides different worker test instance in test mode', async () => {
      mockIsTestMode.mockReturnValue(true);
      mockGetTestInstanceId.mockReturnValue('test-worker-2');
      // isTestInstance returns true for test-worker-* instances
      mockIsTestInstance.mockImplementation((id: string) =>
        id.startsWith('test-worker-')
      );
      mockStore.set('instances', [
        {
          id: 'test-worker-1', // Different worker's test instance
          name: 'Test Worker 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);
      mockStore.set('active_instance', 'test-worker-1');

      const instance = await initializeRegistry();

      // Should override different worker's test instance with our own
      expect(instance.id).toBe('test-worker-2');
      expect(instance.name).toBe('Test Worker 2');
      expect(await getActiveInstanceId()).toBe('test-worker-2');

      const storedInstances = getStoredInstances();
      expect(storedInstances.map((stored) => stored.id)).toEqual([
        'test-worker-1',
        'test-worker-2'
      ]);
    });

    it('respects non-test instance in test mode for within-test state', async () => {
      mockIsTestMode.mockReturnValue(true);
      mockGetTestInstanceId.mockReturnValue('test-worker-2');
      // isTestInstance returns true only for test-worker-* instances
      mockIsTestInstance.mockImplementation((id: string) =>
        id.startsWith('test-worker-')
      );
      mockStore.set('instances', [
        {
          id: 'test-worker-2',
          name: 'Test Worker 2',
          createdAt: 1000,
          lastAccessedAt: 2000
        },
        {
          id: 'user-created-uuid', // Non-test instance (user created during test)
          name: 'Instance 2',
          createdAt: 3000,
          lastAccessedAt: 4000
        }
      ]);
      mockStore.set('active_instance', 'user-created-uuid');

      const instance = await initializeRegistry();

      // Should respect non-test instance (preserves within-test state like page reload)
      expect(instance.id).toBe('user-created-uuid');
      expect(instance.name).toBe('Instance 2');
    });

    it('re-initializes when cached instance was deleted', async () => {
      // First call creates and caches an instance
      const firstInstance = await initializeRegistry();
      expect(firstInstance.name).toBe('Instance 1');

      // Simulate storage being cleared (e.g., during Electron testing)
      mockStore.clear();

      // Second call should detect the cached instance no longer exists
      // and re-initialize instead of returning stale cached data
      const secondInstance = await initializeRegistry();

      // Should create a new instance since the old one was deleted
      expect(secondInstance.name).toBe('Instance 1');
      // Verify the instance exists in storage (was re-created)
      const storedInstances = getStoredInstances();
      expect(storedInstances.length).toBe(1);
      expect(storedInstances[0]?.id).toBe(secondInstance.id);
    });
  });

  describe('clearRegistry', () => {
    it('clears all data from store', async () => {
      mockStore.set('instances', [
        {
          id: 'test',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);
      mockStore.set('active_instance', 'test');

      await clearRegistry();

      // The mock store.clear is called
      expect(mockObjectStore.clear).toHaveBeenCalled();
    });
  });

  describe('getActiveInstance', () => {
    it('returns null when no active instance is set', async () => {
      const result = await getActiveInstance();
      expect(result).toBeNull();
    });

    it('returns the active instance when set', async () => {
      const instance: InstanceMetadata = {
        id: 'active-id',
        name: 'Instance 1',
        createdAt: 1000,
        lastAccessedAt: 2000
      };
      mockStore.set('instances', [instance]);
      mockStore.set('active_instance', 'active-id');

      const result = await getActiveInstance();
      expect(result).toEqual(instance);
    });

    it('returns null when active instance not found in list', async () => {
      mockStore.set('instances', [
        {
          id: 'other-id',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);
      mockStore.set('active_instance', 'nonexistent');

      const result = await getActiveInstance();
      expect(result).toBeNull();
    });
  });

  describe('getInstance', () => {
    it('returns the matching instance', async () => {
      const instance: InstanceMetadata = {
        id: 'target-id',
        name: 'Instance 1',
        createdAt: 1000,
        lastAccessedAt: 2000
      };
      mockStore.set('instances', [instance]);

      const result = await getInstance('target-id');
      expect(result).toEqual(instance);
    });

    it('returns null when instance is missing', async () => {
      mockStore.set('instances', []);

      const result = await getInstance('missing-id');
      expect(result).toBeNull();
    });
  });

  describe('getRegistryData', () => {
    it('returns instances and active instance id', async () => {
      const instances: InstanceMetadata[] = [
        {
          id: 'inst-1',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ];
      mockStore.set('instances', instances);
      mockStore.set('active_instance', 'inst-1');

      const data = await getRegistryData();

      expect(data.instances).toEqual(instances);
      expect(data.activeInstanceId).toBe('inst-1');
    });
  });
});
