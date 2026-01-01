/**
 * Unit tests for web-crypto utilities.
 *
 * Note: These tests use mocks for crypto.subtle operations since the
 * Node.js and browser Web Crypto APIs have subtle differences that
 * cause issues in CI environments.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSalt, secureZero } from './web-crypto';

// Mock crypto.subtle for consistent behavior across environments
const mockCryptoKey = {
  type: 'secret' as const,
  extractable: true,
  algorithm: { name: 'AES-GCM', length: 256 },
  usages: ['encrypt', 'decrypt'] as KeyUsage[]
};

const mockNonExtractableKey = {
  type: 'secret' as const,
  extractable: false,
  algorithm: { name: 'AES-KW', length: 256 },
  usages: ['wrapKey', 'unwrapKey'] as KeyUsage[]
};

const mockSubtle = {
  generateKey: vi.fn().mockResolvedValue(mockCryptoKey),
  exportKey: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
  importKey: vi.fn().mockResolvedValue(mockCryptoKey),
  deriveKey: vi.fn().mockResolvedValue(mockCryptoKey),
  encrypt: vi.fn().mockResolvedValue(new ArrayBuffer(45)), // 12 IV + 17 data + 16 tag
  decrypt: vi.fn().mockResolvedValue(new ArrayBuffer(5)),
  wrapKey: vi.fn().mockResolvedValue(new ArrayBuffer(40)),
  unwrapKey: vi.fn().mockResolvedValue(mockCryptoKey)
};

// Store original crypto
const originalCrypto = globalThis.crypto;

describe('web-crypto', () => {
  describe('generateSalt', () => {
    it('generates a 32-byte salt', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(32);
    });

    it('generates unique salts', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      // Convert to strings to compare - should be different
      const str1 = Array.from(salt1).join(',');
      const str2 = Array.from(salt2).join(',');
      expect(str1).not.toEqual(str2);
    });
  });

  describe('secureZero', () => {
    it('zeroes out a buffer', () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      secureZero(buffer);

      // Should be all zeros
      expect(buffer.every((b) => b === 0)).toBe(true);
    });

    it('works on empty buffer', () => {
      const buffer = new Uint8Array(0);
      expect(() => secureZero(buffer)).not.toThrow();
    });

    it('works on large buffer', () => {
      const buffer = new Uint8Array(1000).fill(255);
      secureZero(buffer);
      expect(buffer.every((b) => b === 0)).toBe(true);
    });
  });

  // Tests that use crypto.subtle are mocked to avoid Node.js/browser differences
  describe('generateRandomKey (mocked)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Mock crypto.subtle
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          ...originalCrypto,
          subtle: mockSubtle,
          getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
        },
        writable: true,
        configurable: true
      });
    });

    it('generates a 32-byte key', async () => {
      // Re-import to use mocked crypto
      const { generateRandomKey } = await import('./web-crypto');
      const key = await generateRandomKey();

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
      expect(mockSubtle.generateKey).toHaveBeenCalled();
      expect(mockSubtle.exportKey).toHaveBeenCalled();
    });
  });

  describe('deriveKeyFromPassword (mocked)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          ...originalCrypto,
          subtle: mockSubtle,
          getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
        },
        writable: true,
        configurable: true
      });
    });

    it('derives a CryptoKey from password and salt', async () => {
      const { deriveKeyFromPassword } = await import('./web-crypto');
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('testPassword', salt);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(mockSubtle.importKey).toHaveBeenCalled();
      expect(mockSubtle.deriveKey).toHaveBeenCalled();
    });
  });

  describe('exportKey and importKey (mocked)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          ...originalCrypto,
          subtle: mockSubtle,
          getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
        },
        writable: true,
        configurable: true
      });
    });

    it('exports key to Uint8Array', async () => {
      const { exportKey } = await import('./web-crypto');
      const exported = await exportKey(mockCryptoKey as CryptoKey);

      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported.length).toBe(32);
      expect(mockSubtle.exportKey).toHaveBeenCalledWith('raw', mockCryptoKey);
    });

    it('imports raw bytes as CryptoKey', async () => {
      const { importKey } = await import('./web-crypto');
      const rawKey = new Uint8Array(32).fill(1);
      const key = await importKey(rawKey);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(mockSubtle.importKey).toHaveBeenCalled();
    });
  });

  describe('encrypt and decrypt (mocked)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          ...originalCrypto,
          subtle: mockSubtle,
          getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
        },
        writable: true,
        configurable: true
      });
    });

    it('encrypts data and prepends IV', async () => {
      const { encrypt } = await import('./web-crypto');
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encrypt(data, mockCryptoKey as CryptoKey);

      // Result includes 12-byte IV + ciphertext from mock
      expect(encrypted.length).toBe(12 + 45);
      expect(mockSubtle.encrypt).toHaveBeenCalled();
    });

    it('decrypts data', async () => {
      const { decrypt } = await import('./web-crypto');
      // Create fake encrypted data: 12-byte IV + ciphertext
      const encryptedData = new Uint8Array(45);
      originalCrypto.getRandomValues(encryptedData);

      const decrypted = await decrypt(
        encryptedData,
        mockCryptoKey as CryptoKey
      );

      expect(decrypted).toBeInstanceOf(Uint8Array);
      expect(mockSubtle.decrypt).toHaveBeenCalled();
    });
  });

  describe('encryptString and decryptString (mocked)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          ...originalCrypto,
          subtle: mockSubtle,
          getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
        },
        writable: true,
        configurable: true
      });
    });

    it('encrypts string to base64', async () => {
      const { encryptString } = await import('./web-crypto');
      const message = 'Hello, World!';

      const encrypted = await encryptString(
        message,
        mockCryptoKey as CryptoKey
      );

      expect(typeof encrypted).toBe('string');
      // Should be valid base64
      expect(() => atob(encrypted)).not.toThrow();
    });

    it('decrypts base64 to string', async () => {
      // Mock decrypt to return encoded "Hello"
      const encoder = new TextEncoder();
      mockSubtle.decrypt.mockResolvedValueOnce(encoder.encode('Hello').buffer);

      const { decryptString } = await import('./web-crypto');
      // Create a fake base64 encrypted string (12 IV + some data)
      const fakeEncrypted = btoa(
        String.fromCharCode(...new Uint8Array(30).fill(0))
      );

      const decrypted = await decryptString(
        fakeEncrypted,
        mockCryptoKey as CryptoKey
      );

      expect(decrypted).toBe('Hello');
    });
  });

  describe('generateWrappingKey (mocked)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockSubtle.generateKey.mockResolvedValue(mockNonExtractableKey);
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          ...originalCrypto,
          subtle: mockSubtle,
          getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
        },
        writable: true,
        configurable: true
      });
    });

    it('generates a non-extractable wrapping key', async () => {
      const { generateWrappingKey } = await import('./web-crypto');
      const key = await generateWrappingKey();

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(false);
      expect(mockSubtle.generateKey).toHaveBeenCalledWith(
        { name: 'AES-KW', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
      );
    });
  });

  describe('wrapKey and unwrapKey (mocked)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          ...originalCrypto,
          subtle: mockSubtle,
          getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
        },
        writable: true,
        configurable: true
      });
    });

    it('wraps a key', async () => {
      const { wrapKey } = await import('./web-crypto');
      const originalKey = new Uint8Array(32).fill(1);

      const wrapped = await wrapKey(
        originalKey,
        mockNonExtractableKey as CryptoKey
      );

      expect(wrapped).toBeInstanceOf(Uint8Array);
      expect(wrapped.length).toBe(40); // 32 + 8 for AES-KW
      expect(mockSubtle.importKey).toHaveBeenCalled();
      expect(mockSubtle.wrapKey).toHaveBeenCalled();
    });

    it('unwraps a key', async () => {
      // Mock exportKey to return 32-byte key
      mockSubtle.exportKey.mockResolvedValueOnce(new ArrayBuffer(32));

      const { unwrapKey } = await import('./web-crypto');
      const wrappedKey = new Uint8Array(40).fill(1);

      const unwrapped = await unwrapKey(
        wrappedKey,
        mockNonExtractableKey as CryptoKey
      );

      expect(unwrapped).toBeInstanceOf(Uint8Array);
      expect(unwrapped.length).toBe(32);
      expect(mockSubtle.unwrapKey).toHaveBeenCalled();
      expect(mockSubtle.exportKey).toHaveBeenCalled();
    });
  });
});
