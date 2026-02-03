/**
 * Cryptographic utilities for backup encryption/decryption.
 *
 * Uses Web Crypto API for cross-platform compatibility:
 * - PBKDF2 for key derivation from password
 * - AES-256-GCM for authenticated encryption
 */

import {
  AES_KEY_BITS,
  AUTH_TAG_SIZE,
  IV_SIZE,
  PBKDF2_ITERATIONS,
  SALT_SIZE
} from './constants';

/**
 * Generate a random salt for PBKDF2 key derivation.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_SIZE));
}

/**
 * Generate a random IV for AES-GCM encryption.
 */
export function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_SIZE));
}

/**
 * Derive an AES-256 key from a password using PBKDF2.
 *
 * @param password - User-provided password
 * @param salt - Random salt (must be stored with encrypted data)
 * @returns CryptoKey suitable for AES-GCM operations
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Create a proper ArrayBuffer from the Uint8Array to satisfy BufferSource type
  const saltBuffer = new Uint8Array(salt).buffer;

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-256-GCM.
 *
 * @param data - Plaintext data to encrypt
 * @param key - AES key derived from password
 * @returns Object containing IV and ciphertext (includes auth tag)
 */
export async function encrypt(
  data: Uint8Array,
  key: CryptoKey
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = generateIv();

  // Create proper ArrayBuffers from Uint8Arrays to satisfy BufferSource type
  const dataBuffer = new Uint8Array(data).buffer;
  const ivBuffer = new Uint8Array(iv).buffer;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    dataBuffer
  );

  return {
    iv,
    ciphertext: new Uint8Array(ciphertext)
  };
}

/**
 * Decrypt data using AES-256-GCM.
 *
 * @param ciphertext - Encrypted data (includes auth tag)
 * @param key - AES key derived from password
 * @param iv - Initialization vector used during encryption
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong password or tampered data)
 */
export async function decrypt(
  ciphertext: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array
): Promise<Uint8Array> {
  // Create proper ArrayBuffers from Uint8Arrays to satisfy BufferSource type
  const ciphertextBuffer = new Uint8Array(ciphertext).buffer;
  const ivBuffer = new Uint8Array(iv).buffer;

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    ciphertextBuffer
  );

  return new Uint8Array(plaintext);
}

/**
 * Calculate the encrypted size for a given plaintext size.
 * AES-GCM adds a 16-byte authentication tag.
 */
export function encryptedSize(plaintextSize: number): number {
  return plaintextSize + AUTH_TAG_SIZE;
}

/**
 * Calculate the plaintext size for a given ciphertext size.
 */
export function plaintextSize(ciphertextSize: number): number {
  return ciphertextSize - AUTH_TAG_SIZE;
}
