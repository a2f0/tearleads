/**
 * Web Crypto API utilities for database encryption.
 * Uses AES-256-GCM for authenticated encryption.
 */

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

  // Derive AES-GCM key - copy salt to plain ArrayBuffer for Web Crypto compatibility
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
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
  // Copy to plain ArrayBuffer for Web Crypto compatibility
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);

  return crypto.subtle.importKey(
    'raw',
    keyBuffer,
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

  // Build algorithm params - copy additionalData to plain ArrayBuffer if provided
  const algorithm: AesGcmParams = {
    name: ALGORITHM,
    iv,
    tagLength: TAG_LENGTH
  };
  if (additionalData) {
    const aadBuffer = new ArrayBuffer(additionalData.byteLength);
    new Uint8Array(aadBuffer).set(additionalData);
    algorithm.additionalData = aadBuffer;
  }

  // Copy data to plain ArrayBuffer for Web Crypto compatibility
  const dataBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(dataBuffer).set(data);

  const ciphertext = await crypto.subtle.encrypt(algorithm, key, dataBuffer);

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

  // Build algorithm params - copy additionalData to plain ArrayBuffer if provided
  const algorithm: AesGcmParams = {
    name: ALGORITHM,
    iv,
    tagLength: TAG_LENGTH
  };
  if (additionalData) {
    const aadBuffer = new ArrayBuffer(additionalData.byteLength);
    new Uint8Array(aadBuffer).set(additionalData);
    algorithm.additionalData = aadBuffer;
  }

  const decrypted = await crypto.subtle.decrypt(algorithm, key, ciphertext);

  return new Uint8Array(decrypted);
}

/**
 * Encrypt a SQLite page with page number as additional authenticated data.
 * This prevents page reordering attacks.
 */
export async function encryptPage(
  pageData: Uint8Array,
  key: CryptoKey,
  pageNumber: number
): Promise<Uint8Array> {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, pageNumber, true);
  return encrypt(pageData, key, aad);
}

/**
 * Decrypt a SQLite page with page number verification.
 */
export async function decryptPage(
  encryptedPage: Uint8Array,
  key: CryptoKey,
  pageNumber: number
): Promise<Uint8Array> {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, pageNumber, true);
  return decrypt(encryptedPage, key, aad);
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
