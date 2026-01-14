/**
 * Integration test setup for Vitest.
 * Sets up mocks for database adapter and key manager to use WASM-based implementations.
 *
 * Usage: Import this file in tests that need real database I/O:
 *   import '@/test/setup-integration';
 *
 * Or set the INTEGRATION_TESTS=true env var to auto-load via setup.ts
 */

import { afterEach, beforeEach, expect, vi } from 'vitest';
import { WasmNodeAdapter } from '@/db/adapters/wasm-node.adapter';
import type { InstanceMetadata } from '@/db/instance-registry';
import { mockConsoleWarn } from './console-mocks';
import {
  getTestKeyManager,
  resetTestKeyManager,
  TestKeyManager
} from './test-key-manager';

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

// Mock the instance registry to avoid IndexedDB
vi.mock('@/db/instance-registry', () => ({
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
  deleteFileStorageForInstance: vi.fn(async () => {}),
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
export function resetTestInstanceRegistry(): void {
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

/**
 * Helper to get the currently active adapter (for test assertions).
 */
export function getActiveAdapter(): WasmNodeAdapter | null {
  return activeAdapter;
}

/**
 * Helper to manually create a fresh adapter for tests that need explicit control.
 */
export function createTestAdapter(
  options?: ConstructorParameters<typeof WasmNodeAdapter>[0]
): WasmNodeAdapter {
  return new WasmNodeAdapter(options);
}
