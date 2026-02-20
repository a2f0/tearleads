/**
 * Shared mocks and utilities for KeyManager tests.
 *
 * IMPORTANT: Each test file must include vi.mock() calls that reference these
 * implementations. vi.mock() is hoisted and must be in each test file.
 */

import { vi } from 'vitest';

export let keyBytesByKey = new WeakMap<object, Uint8Array>();

export function resetKeyBytesMap() {
  keyBytesByKey = new WeakMap();
}

// Password tracking for mock crypto operations
const passwordByKey = new WeakMap<object, string>();

export const createMockCryptoKey = () => ({
  type: 'secret',
  extractable: true,
  algorithm: { name: 'AES-GCM' },
  usages: ['encrypt', 'decrypt']
});

export const encodePassword = (password: string) => {
  const bytes = new Uint8Array(32);
  const sum = Array.from(password).reduce(
    (total, char) => total + char.charCodeAt(0),
    0
  );
  bytes.fill(sum % 255);
  return bytes;
};

// Shared crypto mock factory - use in vi.mock('@tearleads/shared', ...)
export const createSharedMock = () => ({
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
});

// Native secure storage mock factory
export const createNativeStorageMock = () => ({
  clearSession: vi.fn(async () => undefined),
  getTrackedKeystoreInstanceIds: vi.fn(async () => []),
  hasSession: vi.fn(async () => false),
  isBiometricAvailable: vi.fn(async () => ({ isAvailable: false })),
  retrieveWrappedKey: vi.fn(async () => null),
  retrieveWrappingKeyBytes: vi.fn(async () => null),
  storeWrappedKey: vi.fn(async () => true),
  storeWrappingKeyBytes: vi.fn(async () => true)
});

// Utils mock factory
export const createUtilsMock = () => ({
  detectPlatform: vi.fn(() => 'web')
});

// Mock crypto.subtle for KCV generation
export const mockEncrypt = vi.fn(async (_algo, key) => {
  const buffer = new Uint8Array(32);
  if (typeof key === 'object' && key !== null) {
    const keyBytes = keyBytesByKey.get(key);
    if (keyBytes) {
      buffer.set(keyBytes.slice(0, 32));
    }
  }
  return buffer.buffer;
});

// Mock IndexedDB for WebKeyStorage
export const mockIDBStore = new Map<string, unknown>();

type MockIDBRequest = {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

export const mockIDBRequest = (result: unknown): MockIDBRequest => ({
  result,
  error: null,
  onsuccess: null,
  onerror: null
});

export const mockObjectStore = {
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

export function createMockTransaction() {
  const tx = {
    objectStore: vi.fn(() => mockObjectStore),
    oncomplete: null as (() => void) | null
  };
  // Schedule oncomplete to fire after current operations
  setTimeout(() => tx.oncomplete?.(), 10);
  return tx;
}

export const mockDB = {
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

export const createOpenRequest = (): MockOpenRequest => ({
  result: mockDB,
  error: null,
  onsuccess: null,
  onerror: null,
  onupgradeneeded: null
});

export const indexedDbOpenMock = vi.fn(() => {
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
});

export const flushTimers = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
};

export const TEST_INSTANCE_ID = 'test-instance';

/**
 * Setup global mocks that all keyManager tests need.
 * Call this before importing keyManager in each test file.
 */
export function setupGlobalMocks() {
  Object.defineProperty(global, 'crypto', {
    value: {
      subtle: {
        encrypt: mockEncrypt
      },
      getRandomValues: vi.fn((arr: Uint8Array) => arr.fill(0))
    },
    configurable: true
  });

  vi.stubGlobal('indexedDB', {
    open: indexedDbOpenMock
  });
}

// Auto-setup global mocks when this module is imported
setupGlobalMocks();
