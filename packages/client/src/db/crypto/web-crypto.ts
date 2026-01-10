/**
 * Web Crypto API utilities for database encryption.
 * Uses AES-256-GCM for authenticated encryption.
 */

import { assertPlainArrayBuffer } from '@rapid/shared';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const TAG_LENGTH = 128; // Authentication tag length in bits
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 600000; // OWASP 2023 recommendation

/**
 * Generate a cryptographically secure random salt.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Generate a random encryption key.
 */
export async function generateRandomKey(): Promise<Uint8Array> {
  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
  const exported = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(exported);
}

/**
 * Derive an encryption key from a password using PBKDF2.
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  assertPlainArrayBuffer(salt);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable for export to worker
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to raw bytes.
 */
export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(exported);
}

/**
 * Import raw key bytes as a CryptoKey.
 */
export async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  assertPlainArrayBuffer(keyBytes);

  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-GCM.
 * Returns IV prepended to ciphertext.
 */
export async function encrypt(
  data: Uint8Array,
  key: CryptoKey,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  assertPlainArrayBuffer(data);

  const algorithm: AesGcmParams = {
    name: ALGORITHM,
    iv,
    tagLength: TAG_LENGTH
  };
  if (additionalData) {
    assertPlainArrayBuffer(additionalData);
    algorithm.additionalData = additionalData;
  }

  const ciphertext = await crypto.subtle.encrypt(algorithm, key, data);

  // Prepend IV to ciphertext
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return result;
}

/**
 * Decrypt data using AES-GCM.
 * Expects IV prepended to ciphertext.
 */
export async function decrypt(
  encryptedData: Uint8Array,
  key: CryptoKey,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  const iv = encryptedData.slice(0, IV_LENGTH);
  const ciphertext = encryptedData.slice(IV_LENGTH);

  const algorithm: AesGcmParams = {
    name: ALGORITHM,
    iv,
    tagLength: TAG_LENGTH
  };
  if (additionalData) {
    assertPlainArrayBuffer(additionalData);
    algorithm.additionalData = additionalData;
  }

  const decrypted = await crypto.subtle.decrypt(algorithm, key, ciphertext);

  return new Uint8Array(decrypted);
}

/**
 * Securely zero out a buffer to prevent key leakage.
 */
export function secureZero(buffer: Uint8Array): void {
  crypto.getRandomValues(buffer); // Overwrite with random data
  buffer.fill(0); // Then zero out
}

/**
 * Encrypt a string value (for storing secrets).
 */
export async function encryptString(
  value: string,
  key: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const encrypted = await encrypt(data, key);
  return btoa(String.fromCharCode(...encrypted));
}

/**
 * Decrypt a string value.
 */
export async function decryptString(
  encryptedValue: string,
  key: CryptoKey
): Promise<string> {
  const encrypted = Uint8Array.from(atob(encryptedValue), (c) =>
    c.charCodeAt(0)
  );
  const decrypted = await decrypt(encrypted, key);
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Generate a non-extractable wrapping key for session persistence.
 * This key can be stored in IndexedDB but its raw bytes cannot be exported.
 */
export async function generateWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-KW', length: 256 },
    false, // non-extractable - key bytes cannot be read by JavaScript
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Generate an extractable wrapping key for mobile platforms.
 * This key can be exported to raw bytes for storage in native secure storage.
 * Security on mobile relies on Keychain/Keystore hardware protection rather than
 * Web Crypto's non-extractable property.
 */
export async function generateExtractableWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-KW', length: 256 },
    true, // extractable - needed for native storage
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Export a wrapping key to raw bytes.
 */
export async function exportWrappingKey(key: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(exported);
}

/**
 * Import raw bytes as a wrapping key.
 */
export async function importWrappingKey(
  keyBytes: Uint8Array
): Promise<CryptoKey> {
  assertPlainArrayBuffer(keyBytes);

  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-KW', length: 256 },
    true, // extractable for re-export if needed
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Wrap (encrypt) a key using a wrapping key.
 * Returns the wrapped key as a Uint8Array.
 */
export async function wrapKey(
  keyToWrap: Uint8Array,
  wrappingKey: CryptoKey
): Promise<Uint8Array> {
  assertPlainArrayBuffer(keyToWrap);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyToWrap,
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // must be extractable to wrap
    ['encrypt', 'decrypt']
  );

  const wrapped = await crypto.subtle.wrapKey('raw', cryptoKey, wrappingKey, {
    name: 'AES-KW'
  });

  return new Uint8Array(wrapped);
}

/**
 * Unwrap (decrypt) a wrapped key using a wrapping key.
 * Returns the unwrapped key as a Uint8Array.
 */
export async function unwrapKey(
  wrappedKey: Uint8Array,
  wrappingKey: CryptoKey
): Promise<Uint8Array> {
  assertPlainArrayBuffer(wrappedKey);

  const unwrappedCryptoKey = await crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    wrappingKey,
    { name: 'AES-KW' },
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable so we can get the raw bytes
    ['encrypt', 'decrypt']
  );

  const exported = await crypto.subtle.exportKey('raw', unwrappedCryptoKey);
  return new Uint8Array(exported);
}
