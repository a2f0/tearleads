import { describe, expect, it } from 'vitest';
import {
  decrypt,
  decryptString,
  deriveKeyFromPassword,
  encrypt,
  encryptString,
  exportKey,
  exportWrappingKey,
  generateExtractableWrappingKey,
  generateRandomKey,
  generateSalt,
  generateWrappingKey,
  importKey,
  importWrappingKey,
  secureZero,
  unwrapKey,
  wrapKey
} from './web-crypto.js';

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
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('generateRandomKey', () => {
    it('generates a 32-byte random key', async () => {
      const key = await generateRandomKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('generates unique keys', async () => {
      const key1 = await generateRandomKey();
      const key2 = await generateRandomKey();
      expect(key1).not.toEqual(key2);
    });
  });

  describe('deriveKeyFromPassword', () => {
    it('derives a key from password and salt', async () => {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('test-password', salt);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('derives the same key for same password and salt', async () => {
      const salt = generateSalt();
      const key1 = await deriveKeyFromPassword('test-password', salt);
      const key2 = await deriveKeyFromPassword('test-password', salt);

      const exported1 = await exportKey(key1);
      const exported2 = await exportKey(key2);

      expect(exported1).toEqual(exported2);
    });

    it('derives different keys for different passwords', async () => {
      const salt = generateSalt();
      const key1 = await deriveKeyFromPassword('password1', salt);
      const key2 = await deriveKeyFromPassword('password2', salt);

      const exported1 = await exportKey(key1);
      const exported2 = await exportKey(key2);

      expect(exported1).not.toEqual(exported2);
    });

    it('derives different keys for different salts', async () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const key1 = await deriveKeyFromPassword('test-password', salt1);
      const key2 = await deriveKeyFromPassword('test-password', salt2);

      const exported1 = await exportKey(key1);
      const exported2 = await exportKey(key2);

      expect(exported1).not.toEqual(exported2);
    });
  });

  describe('exportKey / importKey', () => {
    it('exports and imports a key', async () => {
      const salt = generateSalt();
      const originalKey = await deriveKeyFromPassword('test-password', salt);
      const exported = await exportKey(originalKey);

      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported.length).toBe(32);

      const importedKey = await importKey(exported);
      expect(importedKey.type).toBe('secret');
      expect(importedKey.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('encrypt / decrypt', () => {
    it('encrypts and decrypts data', async () => {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('test-password', salt);
      const plaintext = new TextEncoder().encode('Hello, World!');

      const ciphertext = await encrypt(plaintext, key);
      expect(ciphertext).toBeInstanceOf(Uint8Array);
      expect(ciphertext.length).toBeGreaterThan(plaintext.length);

      const decrypted = await decrypt(ciphertext, key);
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!');
    });

    it('encrypts with additional data', async () => {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('test-password', salt);
      const plaintext = new TextEncoder().encode('Hello, World!');
      const aad = new TextEncoder().encode('additional-data');

      const ciphertext = await encrypt(plaintext, key, aad);
      const decrypted = await decrypt(ciphertext, key, aad);

      expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!');
    });

    it('fails to decrypt with wrong additional data', async () => {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('test-password', salt);
      const plaintext = new TextEncoder().encode('Hello, World!');
      const aad = new TextEncoder().encode('additional-data');
      const wrongAad = new TextEncoder().encode('wrong-data');

      const ciphertext = await encrypt(plaintext, key, aad);

      await expect(decrypt(ciphertext, key, wrongAad)).rejects.toThrow();
    });

    it('fails to decrypt with wrong key', async () => {
      const salt = generateSalt();
      const key1 = await deriveKeyFromPassword('password1', salt);
      const key2 = await deriveKeyFromPassword('password2', salt);
      const plaintext = new TextEncoder().encode('Hello, World!');

      const ciphertext = await encrypt(plaintext, key1);

      await expect(decrypt(ciphertext, key2)).rejects.toThrow();
    });
  });

  describe('secureZero', () => {
    it('zeros out a buffer', () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      secureZero(buffer);

      expect(buffer).toEqual(new Uint8Array([0, 0, 0, 0, 0]));
    });
  });

  describe('encryptString / decryptString', () => {
    it('encrypts and decrypts a string', async () => {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword('test-password', salt);

      const encrypted = await encryptString('Hello, World!', key);
      expect(typeof encrypted).toBe('string');

      const decrypted = await decryptString(encrypted, key);
      expect(decrypted).toBe('Hello, World!');
    });
  });

  describe('wrapping key operations', () => {
    it('generates a non-extractable wrapping key', async () => {
      const key = await generateWrappingKey();
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-KW');
      expect(key.extractable).toBe(false);
    });

    it('generates an extractable wrapping key', async () => {
      const key = await generateExtractableWrappingKey();
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-KW');
      expect(key.extractable).toBe(true);
    });

    it('exports and imports a wrapping key', async () => {
      const originalKey = await generateExtractableWrappingKey();
      const exported = await exportWrappingKey(originalKey);

      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported.length).toBe(32);

      const importedKey = await importWrappingKey(exported);
      expect(importedKey.type).toBe('secret');
      expect(importedKey.algorithm.name).toBe('AES-KW');
    });
  });

  describe('wrapKey / unwrapKey', () => {
    it('wraps and unwraps a key', async () => {
      const salt = generateSalt();
      const dataKey = await deriveKeyFromPassword('test-password', salt);
      const dataKeyBytes = await exportKey(dataKey);

      const wrappingKey = await generateExtractableWrappingKey();
      const wrapped = await wrapKey(dataKeyBytes, wrappingKey);

      expect(wrapped).toBeInstanceOf(Uint8Array);
      expect(wrapped.length).toBeGreaterThan(dataKeyBytes.length);

      const unwrapped = await unwrapKey(wrapped, wrappingKey);
      expect(unwrapped).toEqual(dataKeyBytes);
    });

    it('fails to unwrap with wrong wrapping key', async () => {
      const salt = generateSalt();
      const dataKey = await deriveKeyFromPassword('test-password', salt);
      const dataKeyBytes = await exportKey(dataKey);

      const wrappingKey1 = await generateExtractableWrappingKey();
      const wrappingKey2 = await generateExtractableWrappingKey();

      const wrapped = await wrapKey(dataKeyBytes, wrappingKey1);

      await expect(unwrapKey(wrapped, wrappingKey2)).rejects.toThrow();
    });
  });
});
