import { describe, expect, it } from 'vitest';

import { AUTH_TAG_SIZE, IV_SIZE, SALT_SIZE } from './constants';
import {
  decrypt,
  deriveKey,
  encrypt,
  encryptedSize,
  generateIv,
  generateSalt,
  plaintextSize
} from './crypto';

describe('crypto', () => {
  describe('generateSalt', () => {
    it('generates salt of correct size', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(SALT_SIZE);
    });

    it('generates different salts each time', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toEqual(salt2);
    });

    it('generates non-zero values', () => {
      const salt = generateSalt();
      const hasNonZero = salt.some((byte) => byte !== 0);
      expect(hasNonZero).toBe(true);
    });
  });

  describe('generateIv', () => {
    it('generates IV of correct size', () => {
      const iv = generateIv();
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.length).toBe(IV_SIZE);
    });

    it('generates different IVs each time', () => {
      const iv1 = generateIv();
      const iv2 = generateIv();
      expect(iv1).not.toEqual(iv2);
    });

    it('generates non-zero values', () => {
      const iv = generateIv();
      const hasNonZero = iv.some((byte) => byte !== 0);
      expect(hasNonZero).toBe(true);
    });
  });

  describe('deriveKey', () => {
    it('derives a CryptoKey from password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();

      const key = await deriveKey(password, salt);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('derives the same key for same password and salt', async () => {
      const password = 'consistent-password';
      const salt = generateSalt();

      const key1 = await deriveKey(password, salt);
      const key2 = await deriveKey(password, salt);

      // Encrypt the same data with both keys to verify they're equivalent
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted1 = await encrypt(testData, key1);

      // Decrypt with the second key should work
      const decrypted = await decrypt(
        encrypted1.ciphertext,
        key2,
        encrypted1.iv
      );
      expect(decrypted).toEqual(testData);
    });

    it('derives different keys for different passwords', async () => {
      const salt = generateSalt();

      const key1 = await deriveKey('password1', salt);
      const key2 = await deriveKey('password2', salt);

      // Encrypt with key1
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await encrypt(testData, key1);

      // Decrypt with key2 should fail
      await expect(
        decrypt(encrypted.ciphertext, key2, encrypted.iv)
      ).rejects.toThrow();
    });

    it('derives different keys for different salts', async () => {
      const password = 'same-password';
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      const key1 = await deriveKey(password, salt1);
      const key2 = await deriveKey(password, salt2);

      // Encrypt with key1
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await encrypt(testData, key1);

      // Decrypt with key2 should fail
      await expect(
        decrypt(encrypted.ciphertext, key2, encrypted.iv)
      ).rejects.toThrow();
    });

    it('handles empty password', async () => {
      const salt = generateSalt();
      const key = await deriveKey('', salt);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('handles unicode passwords', async () => {
      const password = '密码🔐パスワード';
      const salt = generateSalt();

      const key = await deriveKey(password, salt);

      expect(key).toBeDefined();

      // Verify encryption/decryption works with unicode-derived key
      const testData = new Uint8Array([1, 2, 3]);
      const encrypted = await encrypt(testData, key);
      const decrypted = await decrypt(encrypted.ciphertext, key, encrypted.iv);
      expect(Array.from(decrypted)).toEqual(Array.from(testData));
    });

    it('handles long passwords', async () => {
      const password = 'a'.repeat(10000);
      const salt = generateSalt();

      const key = await deriveKey(password, salt);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });
  });

  describe('encrypt and decrypt', () => {
    it('encrypts and decrypts data correctly', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      const plaintext = new TextEncoder().encode('Hello, World!');
      const { iv, ciphertext } = await encrypt(plaintext, key);

      const decrypted = await decrypt(ciphertext, key, iv);
      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    });

    it('produces ciphertext larger than plaintext by auth tag size', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      const plaintext = new Uint8Array(100);
      const { ciphertext } = await encrypt(plaintext, key);

      expect(ciphertext.length).toBe(plaintext.length + AUTH_TAG_SIZE);
    });

    it('produces different ciphertext for same plaintext due to random IV', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const result1 = await encrypt(plaintext, key);
      const result2 = await encrypt(plaintext, key);

      // IVs should be different
      expect(result1.iv).not.toEqual(result2.iv);
      // Ciphertexts should be different
      expect(result1.ciphertext).not.toEqual(result2.ciphertext);
    });

    it('fails to decrypt with wrong IV', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const { ciphertext } = await encrypt(plaintext, key);

      const wrongIv = generateIv();
      await expect(decrypt(ciphertext, key, wrongIv)).rejects.toThrow();
    });

    it('fails to decrypt with tampered ciphertext', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const { iv, ciphertext } = await encrypt(plaintext, key);

      // Tamper with the ciphertext
      const tampered = new Uint8Array(ciphertext);
      tampered[0] = (tampered[0] ?? 0) ^ 0xff;

      await expect(decrypt(tampered, key, iv)).rejects.toThrow();
    });

    it('fails to decrypt with tampered auth tag', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const { iv, ciphertext } = await encrypt(plaintext, key);

      // Tamper with the auth tag (last 16 bytes)
      const tampered = new Uint8Array(ciphertext);
      const lastIdx = tampered.length - 1;
      tampered[lastIdx] = (tampered[lastIdx] ?? 0) ^ 0xff;

      await expect(decrypt(tampered, key, iv)).rejects.toThrow();
    });

    it('handles empty data', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      const plaintext = new Uint8Array(0);
      const { iv, ciphertext } = await encrypt(plaintext, key);

      expect(ciphertext.length).toBe(AUTH_TAG_SIZE);

      const decrypted = await decrypt(ciphertext, key, iv);
      expect(decrypted.length).toBe(0);
    });

    it('handles large data', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      // 1 MB of data
      const plaintext = new Uint8Array(1024 * 1024);
      for (let i = 0; i < plaintext.length; i++) {
        plaintext[i] = i % 256;
      }

      const { iv, ciphertext } = await encrypt(plaintext, key);
      const decrypted = await decrypt(ciphertext, key, iv);

      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    });

    it('handles binary data with all byte values', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);

      // All possible byte values
      const plaintext = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        plaintext[i] = i;
      }

      const { iv, ciphertext } = await encrypt(plaintext, key);
      const decrypted = await decrypt(ciphertext, key, iv);

      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    });
  });

  describe('encryptedSize', () => {
    it('calculates encrypted size correctly', () => {
      expect(encryptedSize(0)).toBe(AUTH_TAG_SIZE);
      expect(encryptedSize(100)).toBe(100 + AUTH_TAG_SIZE);
      expect(encryptedSize(1024 * 1024)).toBe(1024 * 1024 + AUTH_TAG_SIZE);
    });
  });

  describe('plaintextSize', () => {
    it('calculates plaintext size correctly', () => {
      expect(plaintextSize(AUTH_TAG_SIZE)).toBe(0);
      expect(plaintextSize(100 + AUTH_TAG_SIZE)).toBe(100);
      expect(plaintextSize(1024 * 1024 + AUTH_TAG_SIZE)).toBe(1024 * 1024);
    });
  });
});
