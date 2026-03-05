/**
 * Integration test setup for Vitest.
 * Sets up mocks for database adapter and key manager to use WASM-based implementations.
 *
 * Usage: Import this file in tests that need real database I/O:
 *   import '@/test/setup-integration';
 *
 * Or set the INTEGRATION_TESTS=true env var to auto-load via setup.ts
 */

import {
  getTestKeyManager,
  resetTestKeyManager,
  TestKeyManager,
  WasmNodeAdapter
} from '@tearleads/db-test-utils';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { InstanceMetadata } from '@/db/instanceRegistry';
import { mockConsoleWarn } from './consoleMocks';

// Store active adapter for cleanup
let activeAdapter: WasmNodeAdapter | null = null;
let warnSpy: ReturnType<typeof mockConsoleWarn> | null = null;

// In-memory instance registry for tests (avoids IndexedDB dependency)
const TEST_INSTANCE_ID = 'test-instance';
let testInstances: InstanceMetadata[] = [
  {
    id: TEST_INSTANCE_ID,
    name: 'Instance 1',
    createdAt: Date.now(),
    lastAccessedAt: Date.now()
  }
];
let testActiveInstanceId: string | null = TEST_INSTANCE_ID;
const mockFileStorageData = new Map<string, Map<string, Uint8Array>>();
const mockFileStorageInstances = new Map<string, MockFileStorage>();
let currentMockStorageInstanceId: string | null = null;

interface MockFileStorage {
  instanceId: string;
  initialize(encryptionKey: Uint8Array): Promise<void>;
  store(id: string, data: Uint8Array): Promise<string>;
  storeBlob(id: string, blob: Blob): Promise<string>;
  measureStore(id: string, data: Uint8Array): Promise<string>;
  measureStoreBlob(id: string, blob: Blob): Promise<string>;
  retrieve(storagePath: string): Promise<Uint8Array>;
  measureRetrieve(storagePath: string): Promise<Uint8Array>;
  delete(storagePath: string): Promise<void>;
  exists(storagePath: string): Promise<boolean>;
  getStorageUsed(): Promise<number>;
  clearAll(): Promise<void>;
}

function assertValidFilename(path: string): void {
  if (path.length === 0 || path.includes('/') || path.includes('\\')) {
    throw new TypeError('Invalid filename');
  }
}

function getStorageDataForInstance(instanceId: string): Map<string, Uint8Array> {
  let storageData = mockFileStorageData.get(instanceId);
  if (!storageData) {
    storageData = new Map();
    mockFileStorageData.set(instanceId, storageData);
  }
  return storageData;
}

function createMockFileStorage(instanceId: string): MockFileStorage {
  const dataForInstance = getStorageDataForInstance(instanceId);
  const storeData = async (id: string, data: Uint8Array): Promise<string> => {
    const filename = `${id}.enc`;
    assertValidFilename(filename);
    dataForInstance.set(filename, new Uint8Array(data));
    return filename;
  };
  const retrieveData = async (storagePath: string): Promise<Uint8Array> => {
    assertValidFilename(storagePath);
    const stored = dataForInstance.get(storagePath);
    if (!stored) {
      throw new Error(`File not found: ${storagePath}`);
    }
    return new Uint8Array(stored);
  };

  return {
    instanceId,
    async initialize(_encryptionKey: Uint8Array): Promise<void> {
      return;
    },
    async store(id: string, data: Uint8Array): Promise<string> {
      return storeData(id, data);
    },
    async storeBlob(id: string, blob: Blob): Promise<string> {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return storeData(id, bytes);
    },
    async measureStore(id: string, data: Uint8Array): Promise<string> {
      return storeData(id, data);
    },
    async measureStoreBlob(id: string, blob: Blob): Promise<string> {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return storeData(id, bytes);
    },
    async retrieve(storagePath: string): Promise<Uint8Array> {
      return retrieveData(storagePath);
    },
    async measureRetrieve(storagePath: string): Promise<Uint8Array> {
      return retrieveData(storagePath);
    },
    async delete(storagePath: string): Promise<void> {
      assertValidFilename(storagePath);
      dataForInstance.delete(storagePath);
    },
    async exists(storagePath: string): Promise<boolean> {
      assertValidFilename(storagePath);
      return dataForInstance.has(storagePath);
    },
    async getStorageUsed(): Promise<number> {
      let total = 0;
      for (const value of dataForInstance.values()) {
        total += value.byteLength;
      }
      return total;
    },
    async clearAll(): Promise<void> {
      dataForInstance.clear();
    }
  };
}

// Mock the instance registry to avoid IndexedDB
vi.mock('@/db/instanceRegistry', () => ({
  getInstances: vi.fn(async () => testInstances),
  getActiveInstanceId: vi.fn(async () => testActiveInstanceId),
  getActiveInstance: vi.fn(
    async () => testInstances.find((i) => i.id === testActiveInstanceId) ?? null
  ),
  setActiveInstanceId: vi.fn(async (id: string | null) => {
    testActiveInstanceId = id;
  }),
  createInstance: vi.fn(async () => {
    const newInstance: InstanceMetadata = {
      id: `instance-${Date.now()}`,
      name: `Instance ${testInstances.length + 1}`,
      createdAt: Date.now(),
      lastAccessedAt: Date.now()
    };
    testInstances.push(newInstance);
    return newInstance;
  }),
  updateInstance: vi.fn(
    async (id: string, updates: Partial<InstanceMetadata>) => {
      const idx = testInstances.findIndex((i) => i.id === id);
      if (idx !== -1) {
        const existing = testInstances[idx];
        if (existing) {
          testInstances[idx] = { ...existing, ...updates };
        }
      }
    }
  ),
  touchInstance: vi.fn(async (id: string) => {
    const idx = testInstances.findIndex((i) => i.id === id);
    if (idx !== -1) {
      const existing = testInstances[idx];
      if (existing) {
        testInstances[idx] = { ...existing, lastAccessedAt: Date.now() };
      }
    }
  }),
  deleteInstanceFromRegistry: vi.fn(async (id: string) => {
    testInstances = testInstances.filter((i) => i.id !== id);
    if (testActiveInstanceId === id) {
      testActiveInstanceId = testInstances[0]?.id ?? null;
    }
  }),
  getInstance: vi.fn(
    async (id: string) => testInstances.find((i) => i.id === id) ?? null
  ),
  initializeRegistry: vi.fn(async () => {
    if (testInstances.length === 0) {
      const newInstance: InstanceMetadata = {
        id: TEST_INSTANCE_ID,
        name: 'Instance 1',
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
      };
      testInstances.push(newInstance);
      testActiveInstanceId = newInstance.id;
    }
    return (
      testInstances.find((i) => i.id === testActiveInstanceId) ??
      testInstances[0]
    );
  }),
  clearRegistry: vi.fn(async () => {
    testInstances = [];
    testActiveInstanceId = null;
  }),
  getRegistryData: vi.fn(async () => ({
    instances: testInstances,
    activeInstanceId: testActiveInstanceId
  }))
}));

// Mock file storage (OPFS) functions since they're not available in Node.js
vi.mock('@/storage/opfs', () => ({
  initializeFileStorage: vi.fn(
    async (encryptionKey: Uint8Array, instanceId: string) => {
      let storage = mockFileStorageInstances.get(instanceId);
      if (!storage) {
        storage = createMockFileStorage(instanceId);
        mockFileStorageInstances.set(instanceId, storage);
      }
      await storage.initialize(encryptionKey);
      currentMockStorageInstanceId = instanceId;
      return storage;
    }
  ),
  getFileStorageForInstance: vi.fn((instanceId: string) => {
    const storage = mockFileStorageInstances.get(instanceId);
    if (!storage) {
      throw new Error(`File storage not initialized for instance ${instanceId}`);
    }
    return storage;
  }),
  getFileStorage: vi.fn(() => {
    if (!currentMockStorageInstanceId) {
      throw new Error('No current file storage instance');
    }
    const storage = mockFileStorageInstances.get(currentMockStorageInstanceId);
    if (!storage) {
      throw new Error(
        `File storage not initialized for instance ${currentMockStorageInstanceId}`
      );
    }
    return storage;
  }),
  isFileStorageInitialized: vi.fn((instanceId?: string) => {
    if (instanceId) {
      return mockFileStorageInstances.has(instanceId);
    }
    return currentMockStorageInstanceId !== null;
  }),
  clearFileStorageForInstance: vi.fn((instanceId: string) => {
    mockFileStorageInstances.delete(instanceId);
    mockFileStorageData.delete(instanceId);
    if (currentMockStorageInstanceId === instanceId) {
      currentMockStorageInstanceId = null;
    }
  }),
  clearFileStorageInstance: vi.fn(() => {
    mockFileStorageInstances.clear();
    mockFileStorageData.clear();
    currentMockStorageInstanceId = null;
  }),
  setCurrentStorageInstanceId: vi.fn((instanceId: string | null) => {
    currentMockStorageInstanceId = instanceId;
  }),
  getCurrentStorageInstanceId: vi.fn(() => currentMockStorageInstanceId),
  deleteFileStorageForInstance: vi.fn(async (instanceId: string) => {
    mockFileStorageInstances.delete(instanceId);
    mockFileStorageData.delete(instanceId);
    if (currentMockStorageInstanceId === instanceId) {
      currentMockStorageInstanceId = null;
    }
  }),
  getFileStorageRoot: vi.fn(async () => null),
  saveFileToStorage: vi.fn(async () => ''),
  loadFileFromStorage: vi.fn(async () => null),
  deleteFileFromStorage: vi.fn(async () => {})
}));

// Mock the adapter factory to use WasmNodeAdapter
vi.mock('@/db/adapters', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/adapters')>();
  return {
    ...original,
    createAdapter: vi.fn(async () => {
      activeAdapter = new WasmNodeAdapter();
      return activeAdapter;
    }),
    getPlatformInfo: vi.fn(() => ({
      platform: 'node',
      supportsNativeEncryption: true,
      requiresWebWorker: false
    }))
  };
});

// Mock the key manager to use TestKeyManager
vi.mock('@/db/crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/crypto')>();
  return {
    ...original,
    getKeyManagerForInstance: vi.fn(() => getTestKeyManager()),
    setCurrentInstanceId: vi.fn(),
    KeyManager: TestKeyManager
  };
});

/**
 * Reset the test instance registry to initial state.
 */
function resetTestInstanceRegistry(): void {
  testInstances = [
    {
      id: TEST_INSTANCE_ID,
      name: 'Instance 1',
      createdAt: Date.now(),
      lastAccessedAt: Date.now()
    }
  ];
  testActiveInstanceId = TEST_INSTANCE_ID;
}

// Reset state between tests
beforeEach(async () => {
  resetTestKeyManager();
  resetTestInstanceRegistry();
  mockFileStorageInstances.clear();
  mockFileStorageData.clear();
  currentMockStorageInstanceId = null;
  warnSpy = mockConsoleWarn();

  // Reset the database module's internal state
  // This ensures each test starts with a clean slate
  try {
    const { resetDatabase } = await import('@/db');
    await resetDatabase('test-instance');
  } catch {
    // Ignore if database wasn't initialized
  }
});

afterEach(async () => {
  // Clean up any active database connections
  if (activeAdapter) {
    try {
      await activeAdapter.close();
    } catch {
      // Ignore close errors
    }
    activeAdapter = null;
  }
  if (warnSpy) {
    const allowedWarnings = ['Ignoring inability to install OPFS sqlite3_vfs'];
    const unexpectedWarnings = warnSpy.mock.calls.filter((call) => {
      const firstArg = call[0];
      const message =
        typeof firstArg === 'string'
          ? firstArg
          : firstArg instanceof Error
            ? firstArg.message
            : '';
      return !allowedWarnings.some((allowed) => message.includes(allowed));
    });

    expect(unexpectedWarnings).toEqual([]);
    warnSpy.mockRestore();
    warnSpy = null;
  }
});
