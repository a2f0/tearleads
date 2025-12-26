/**
 * Unit tests for KeyManager.
 *
 * These tests mock the underlying crypto operations to test
 * the KeyManager's logic in isolation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyManager } from './key-manager';

// Mock the web-crypto module
vi.mock('./web-crypto', () => ({
  generateSalt: vi.fn(() => new Uint8Array(32).fill(1)),
  deriveKeyFromPassword: vi.fn(async () => ({}) as CryptoKey),
  exportKey: vi.fn(async () => new Uint8Array(32).fill(2)),
  importKey: vi.fn(async () => ({}) as CryptoKey),
  secureZero: vi.fn()
}));

// Mock crypto.subtle for KCV generation
const mockEncrypt = vi.fn(async () => new ArrayBuffer(32));
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
  clear: vi.fn(() => {
    mockIDBStore.clear();
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  })
};

const mockTransaction = {
  objectStore: vi.fn(() => mockObjectStore),
  oncomplete: null as (() => void) | null
};

const mockDB = {
  transaction: vi.fn(() => {
    setTimeout(() => mockTransaction.oncomplete?.(), 0);
    return mockTransaction;
  }),
  close: vi.fn(),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn()
};

const mockOpenRequest = {
  result: mockDB,
  error: null,
  onsuccess: null as (() => void) | null,
  onerror: null as (() => void) | null,
  onupgradeneeded: null as (() => void) | null
};

vi.stubGlobal('indexedDB', {
  open: vi.fn(() => {
    setTimeout(() => mockOpenRequest.onsuccess?.(), 0);
    return mockOpenRequest;
  })
});

// Mock detectPlatform to return 'web'
vi.mock('@/lib/utils', () => ({
  detectPlatform: vi.fn(() => 'web')
}));

describe('KeyManager', () => {
  let keyManager: KeyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    keyManager = new KeyManager();
  });

  describe('hasExistingKey', () => {
    it('returns false when no salt is stored', async () => {
      const result = await keyManager.hasExistingKey();
      expect(result).toBe(false);
    });

    it('returns true when salt exists', async () => {
      mockIDBStore.set('rapid_db_salt', [1, 2, 3]);
      const result = await keyManager.hasExistingKey();
      expect(result).toBe(true);
    });
  });

  describe('setupNewKey', () => {
    it('generates salt and derives key from password', async () => {
      const { generateSalt, deriveKeyFromPassword, exportKey } = await import(
        './web-crypto'
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

      // Check that salt was stored
      expect(mockIDBStore.has('rapid_db_salt')).toBe(true);
      // Check that KCV was stored
      expect(mockIDBStore.has('rapid_db_kcv')).toBe(true);
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
      const freshKeyManager = new KeyManager();
      const result =
        await freshKeyManager.unlockWithPassword('correct-password');

      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('changePassword', () => {
    it('returns old and new keys on successful change', async () => {
      await keyManager.setupNewKey('original-password');

      const freshKeyManager = new KeyManager();
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
      const { secureZero } = await import('./web-crypto');

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
      expect(mockIDBStore.size).toBeGreaterThan(0);

      await keyManager.reset();

      expect(keyManager.getCurrentKey()).toBeNull();
      expect(mockIDBStore.size).toBe(0);
    });
  });
});
