/**
 * Tests for the instance registry.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceMetadata } from './instance-registry';
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
  setActiveInstanceId,
  touchInstance,
  updateInstance
} from './instance-registry';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
});

describe('instance-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  describe('getInstances', () => {
    it('returns empty array when no instances exist', async () => {
      const instances = await getInstances();
      expect(instances).toEqual([]);
    });

    it('returns stored instances', async () => {
      const storedInstances: InstanceMetadata[] = [
        {
          id: 'inst-1',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ];
      mockStore.set('instances', storedInstances);

      const instances = await getInstances();
      expect(instances).toEqual(storedInstances);
    });
  });

  describe('createInstance', () => {
    it('creates first instance with name "Instance 1"', async () => {
      const instance = await createInstance();

      expect(instance.id).toBe('test-uuid-1234');
      expect(instance.name).toBe('Instance 1');
      expect(instance.createdAt).toBeGreaterThan(0);
      expect(instance.lastAccessedAt).toBe(instance.createdAt);
    });

    it('creates second instance with name "Instance 2"', async () => {
      mockStore.set('instances', [
        {
          id: 'existing',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);

      const instance = await createInstance();

      expect(instance.name).toBe('Instance 2');
    });

    it('fills gaps in instance numbering', async () => {
      mockStore.set('instances', [
        {
          id: 'inst-1',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        },
        {
          id: 'inst-3',
          name: 'Instance 3',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);

      const instance = await createInstance();

      expect(instance.name).toBe('Instance 2');
    });

    it('appends new instance to existing list', async () => {
      const existing: InstanceMetadata[] = [
        {
          id: 'existing',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ];
      mockStore.set('instances', existing);

      await createInstance();

      const stored = getStoredInstances();
      expect(stored).toHaveLength(2);
    });
  });

  describe('deleteInstanceFromRegistry', () => {
    it('removes instance from list', async () => {
      mockStore.set('instances', [
        {
          id: 'keep',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        },
        {
          id: 'delete',
          name: 'Instance 2',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);

      await deleteInstanceFromRegistry('delete');

      const stored = getStoredInstances();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe('keep');
    });

    it('clears active instance if deleted', async () => {
      mockStore.set('instances', [
        {
          id: 'delete',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);
      mockStore.set('active_instance', 'delete');

      await deleteInstanceFromRegistry('delete');

      expect(mockStore.get('active_instance')).toBeNull();
    });
  });

  describe('getActiveInstanceId', () => {
    it('returns null when no active instance', async () => {
      const id = await getActiveInstanceId();
      expect(id).toBeNull();
    });

    it('returns stored active instance id', async () => {
      mockStore.set('active_instance', 'test-id');

      const id = await getActiveInstanceId();
      expect(id).toBe('test-id');
    });
  });

  describe('setActiveInstanceId', () => {
    it('stores the active instance id', async () => {
      await setActiveInstanceId('new-active');

      expect(mockStore.get('active_instance')).toBe('new-active');
    });
  });

  describe('updateInstance', () => {
    it('updates instance name', async () => {
      mockStore.set('instances', [
        { id: 'test', name: 'Old Name', createdAt: 1000, lastAccessedAt: 2000 }
      ]);

      await updateInstance('test', { name: 'New Name' });

      const stored = getStoredInstances();
      expect(stored[0]?.name).toBe('New Name');
    });

    it('updates lastAccessedAt', async () => {
      mockStore.set('instances', [
        {
          id: 'test',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: 2000
        }
      ]);

      await updateInstance('test', { lastAccessedAt: 5000 });

      const stored = getStoredInstances();
      expect(stored[0]?.lastAccessedAt).toBe(5000);
    });

    it('throws when instance not found', async () => {
      mockStore.set('instances', []);

      await expect(
        updateInstance('nonexistent', { name: 'Test' })
      ).rejects.toThrow('Instance not found');
    });
  });

  describe('touchInstance', () => {
    it('updates lastAccessedAt timestamp', async () => {
      const oldTimestamp = Date.now() - 10000;
      mockStore.set('instances', [
        {
          id: 'test',
          name: 'Instance 1',
          createdAt: 1000,
          lastAccessedAt: oldTimestamp
        }
      ]);

      await touchInstance('test');

      const stored = getStoredInstances();
      expect(stored[0]?.lastAccessedAt).toBeGreaterThan(oldTimestamp);
    });
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
