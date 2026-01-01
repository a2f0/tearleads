/**
 * Unit tests for web-crypto utilities.
 *
 * Note: Node.js has full Web Crypto support via the global crypto object,
 * which allows us to test the actual crypto operations.
 */

import { describe, expect, it } from 'vitest';
import {
  decrypt,
  decryptString,
  deriveKeyFromPassword,
  encrypt,
  encryptString,
  exportKey,
  generateRandomKey,
  generateSalt,
  generateWrappingKey,
  importKey,
  secureZero,
  unwrapKey,
  wrapKey
} from './web-crypto';

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

  describe('generateRandomKey', () => {
    it('generates a 32-byte key', async () => {
      const key = await generateRandomKey();

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('generates unique keys', async () => {
      const key1 = await generateRandomKey();
      const key2 = await generateRandomKey();

      const str1 = Array.from(key1).join(',');
      const str2 = Array.from(key2).join(',');
      expect(str1).not.toEqual(str2);
    });
  });

  describe('deriveKeyFromPassword', () => {
    it('derives a CryptoKey from password and salt', async () => {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('testPassword', salt);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('produces consistent key for same password and salt', async () => {
      const salt = generateSalt();
      const key1 = await deriveKeyFromPassword('testPassword', salt);
      const key2 = await deriveKeyFromPassword('testPassword', salt);

      const exported1 = await exportKey(key1);
      const exported2 = await exportKey(key2);

      expect(exported1).toEqual(exported2);
    });

    it('produces different keys for different passwords', async () => {
      const salt = generateSalt();
      const key1 = await deriveKeyFromPassword('password1', salt);
      const key2 = await deriveKeyFromPassword('password2', salt);

      const exported1 = await exportKey(key1);
      const exported2 = await exportKey(key2);

      expect(exported1).not.toEqual(exported2);
    });

    it('produces different keys for different salts', async () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const key1 = await deriveKeyFromPassword('testPassword', salt1);
      const key2 = await deriveKeyFromPassword('testPassword', salt2);

      const exported1 = await exportKey(key1);
      const exported2 = await exportKey(key2);

      expect(exported1).not.toEqual(exported2);
    });
  });

  describe('exportKey and importKey', () => {
    it('exports key to Uint8Array', async () => {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('testPassword', salt);
      const exported = await exportKey(key);

      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported.length).toBe(32);
    });

    it('imports raw bytes as CryptoKey', async () => {
      const rawKey = await generateRandomKey();
      const key = await importKey(rawKey);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('round-trips key export and import', async () => {
      const originalKey = await generateRandomKey();
      const imported = await importKey(originalKey);
      const exported = await exportKey(imported);

      expect(exported).toEqual(originalKey);
    });
  });

  describe('encrypt and decrypt', () => {
    it('encrypts data to a larger ciphertext', async () => {
      const key = await importKey(await generateRandomKey());
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encrypt(data, key);

      // Ciphertext includes 12-byte IV + data + 16-byte auth tag
      expect(encrypted.length).toBeGreaterThan(data.length);
      expect(encrypted.length).toBe(12 + data.length + 16);
    });

    it('decrypts ciphertext to original data', async () => {
      const key = await importKey(await generateRandomKey());
      const originalData = new Uint8Array([10, 20, 30, 40, 50]);

      const encrypted = await encrypt(originalData, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(originalData);
    });

    it('produces different ciphertext for same data (due to random IV)', async () => {
      const key = await importKey(await generateRandomKey());
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted1 = await encrypt(data, key);
      const encrypted2 = await encrypt(data, key);

      // IVs should be different
      expect(encrypted1.slice(0, 12)).not.toEqual(encrypted2.slice(0, 12));
    });

    it('fails to decrypt with wrong key', async () => {
      const key1 = await importKey(await generateRandomKey());
      const key2 = await importKey(await generateRandomKey());
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encrypt(data, key1);

      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it('handles empty data', async () => {
      const key = await importKey(await generateRandomKey());
      const data = new Uint8Array(0);

      const encrypted = await encrypt(data, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(data);
    });

    it('handles large data', async () => {
      const key = await importKey(await generateRandomKey());
      const data = new Uint8Array(10000);
      crypto.getRandomValues(data);

      const encrypted = await encrypt(data, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(data);
    });

    it('supports additional authenticated data', async () => {
      const key = await importKey(await generateRandomKey());
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const aad = new Uint8Array([100, 101, 102]);

      const encrypted = await encrypt(data, key, aad);
      const decrypted = await decrypt(encrypted, key, aad);

      expect(decrypted).toEqual(data);
    });

    it('fails to decrypt with wrong additional data', async () => {
      const key = await importKey(await generateRandomKey());
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const aad = new Uint8Array([100, 101, 102]);
      const wrongAad = new Uint8Array([200, 201, 202]);

      const encrypted = await encrypt(data, key, aad);

      await expect(decrypt(encrypted, key, wrongAad)).rejects.toThrow();
    });
  });

  describe('encryptString and decryptString', () => {
    it('encrypts string to base64', async () => {
      const key = await importKey(await generateRandomKey());
      const message = 'Hello, World!';

      const encrypted = await encryptString(message, key);

      expect(typeof encrypted).toBe('string');
      // Should be valid base64
      expect(() => atob(encrypted)).not.toThrow();
    });

    it('decrypts base64 to original string', async () => {
      const key = await importKey(await generateRandomKey());
      const originalMessage = 'Hello, World!';

      const encrypted = await encryptString(originalMessage, key);
      const decrypted = await decryptString(encrypted, key);

      expect(decrypted).toBe(originalMessage);
    });

    it('handles unicode strings', async () => {
      const key = await importKey(await generateRandomKey());
      const message = 'Hello 👋 世界 🌍';

      const encrypted = await encryptString(message, key);
      const decrypted = await decryptString(encrypted, key);

      expect(decrypted).toBe(message);
    });

    it('handles empty string', async () => {
      const key = await importKey(await generateRandomKey());
      const message = '';

      const encrypted = await encryptString(message, key);
      const decrypted = await decryptString(encrypted, key);

      expect(decrypted).toBe(message);
    });
  });

  describe('generateWrappingKey', () => {
    it('generates a non-extractable wrapping key', async () => {
      const key = await generateWrappingKey();

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(false);
    });
  });

  describe('wrapKey and unwrapKey', () => {
    it('wraps and unwraps a key', async () => {
      const wrappingKey = await generateWrappingKey();
      const originalKey = await generateRandomKey();

      const wrapped = await wrapKey(originalKey, wrappingKey);
      const unwrapped = await unwrapKey(wrapped, wrappingKey);

      expect(unwrapped).toEqual(originalKey);
    });

    it('wrapped key is different from original', async () => {
      const wrappingKey = await generateWrappingKey();
      const originalKey = await generateRandomKey();

      const wrapped = await wrapKey(originalKey, wrappingKey);

      // AES-KW adds 8 bytes of integrity check
      expect(wrapped.length).toBe(originalKey.length + 8);
    });

    it('fails to unwrap with wrong key', async () => {
      const wrappingKey1 = await generateWrappingKey();
      const wrappingKey2 = await generateWrappingKey();
      const originalKey = await generateRandomKey();

      const wrapped = await wrapKey(originalKey, wrappingKey1);

      await expect(unwrapKey(wrapped, wrappingKey2)).rejects.toThrow();
    });
  });
});
