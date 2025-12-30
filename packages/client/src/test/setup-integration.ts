/**
 * Integration test setup for Vitest.
 * Sets up mocks for database adapter and key manager to use Node.js-compatible implementations.
 *
 * Usage: Import this file in tests that need real database I/O:
 *   import '@/test/setup-integration';
 *
 * Or set the INTEGRATION_TESTS=true env var to auto-load via setup.ts
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { NodeAdapter } from '@/db/adapters/node.adapter';
import {
  getTestKeyManager,
  resetTestKeyManager,
  TestKeyManager
} from './test-key-manager';

// Store active adapter for cleanup
let activeAdapter: NodeAdapter | null = null;

// Mock the adapter factory to use NodeAdapter
vi.mock('@/db/adapters', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/adapters')>();
  return {
    ...original,
    createAdapter: vi.fn(async () => {
      activeAdapter = new NodeAdapter();
      return activeAdapter;
    }),
    getPlatformInfo: vi.fn(() => ({
      platform: 'node' as const,
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
    getKeyManager: vi.fn(() => getTestKeyManager()),
    KeyManager: TestKeyManager
  };
});

// Reset state between tests
beforeEach(async () => {
  resetTestKeyManager();

  // Reset the database module's internal state
  // This ensures each test starts with a clean slate
  try {
    const { resetDatabase } = await import('@/db');
    await resetDatabase();
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
});

/**
 * Helper to get the currently active adapter (for test assertions).
 */
export function getActiveAdapter(): NodeAdapter | null {
  return activeAdapter;
}

/**
 * Helper to manually create a fresh adapter for tests that need explicit control.
 */
export function createTestAdapter(
  options?: ConstructorParameters<typeof NodeAdapter>[0]
): NodeAdapter {
  return new NodeAdapter(options);
}
