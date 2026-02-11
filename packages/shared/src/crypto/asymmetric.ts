/**
 * Asymmetric cryptography for VFS key exchange.
 *
 * Implements a hybrid post-quantum encryption scheme:
 * - X25519: Classical elliptic curve Diffie-Hellman (fast, well-tested)
 * - ML-KEM-768: Post-quantum Key Encapsulation Mechanism (NIST standardized)
 *
 * The hybrid approach ensures security even if one algorithm is broken:
 * - If quantum computers break X25519, ML-KEM protects you
 * - If ML-KEM has an undiscovered flaw, X25519 protects you
 */

import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

// Constants
const HKDF_INFO = new TextEncoder().encode('tearleads-vfs-hybrid-v1');
const DERIVED_KEY_LENGTH = 32; // 256 bits for AES-256
const NONCE_LENGTH = 12; // 96 bits for AES-GCM

/**
 * A user's encryption keypair for VFS sharing.
 * Contains both X25519 and ML-KEM keys for hybrid encryption.
 */
export interface VfsKeyPair {
  /** X25519 public key (32 bytes) */
  x25519PublicKey: Uint8Array;
  /** X25519 private key (32 bytes) */
  x25519PrivateKey: Uint8Array;
  /** ML-KEM-768 public key (~1184 bytes) */
  mlKemPublicKey: Uint8Array;
  /** ML-KEM-768 private key (~2400 bytes) */
  mlKemPrivateKey: Uint8Array;
}

/**
 * Public keys only (for sharing with others).
 */
export interface VfsPublicKey {
  /** X25519 public key (32 bytes) */
  x25519PublicKey: Uint8Array;
  /** ML-KEM-768 public key (~1184 bytes) */
  mlKemPublicKey: Uint8Array;
}

/**
 * Encapsulated key material for hybrid encryption.
 * This is sent to the recipient along with the ciphertext.
 */
export interface HybridEncapsulation {
  /** X25519 ephemeral public key (32 bytes) */
  x25519EphemeralPublic: Uint8Array;
  /** ML-KEM ciphertext (~1088 bytes) */
  mlKemCiphertext: Uint8Array;
  /** Nonce for AES-GCM (12 bytes) */
  nonce: Uint8Array;
  /** Encrypted data */
  ciphertext: Uint8Array;
}

/**
 * Serialized format for storage/transmission.
 * All fields are base64-encoded for safe storage in text columns.
 */
export interface SerializedKeyPair {
  x25519PublicKey: string;
  x25519PrivateKey: string;
  mlKemPublicKey: string;
  mlKemPrivateKey: string;
}

export interface SerializedPublicKey {
  x25519PublicKey: string;
  mlKemPublicKey: string;
}

export interface SerializedEncapsulation {
  x25519EphemeralPublic: string;
  mlKemCiphertext: string;
  nonce: string;
  ciphertext: string;
}

/**
 * Generate a new VFS keypair for a user.
 * This should be done once during account setup.
 */
export function generateKeyPair(): VfsKeyPair {
  // Generate X25519 keypair
  const x25519PrivateKey = x25519.utils.randomSecretKey();
  const x25519PublicKey = x25519.getPublicKey(x25519PrivateKey);

  // Generate ML-KEM-768 keypair
  const mlKemKeys = ml_kem768.keygen();

  return {
    x25519PublicKey,
    x25519PrivateKey,
    mlKemPublicKey: mlKemKeys.publicKey,
    mlKemPrivateKey: mlKemKeys.secretKey
  };
}

/**
 * Extract only the public keys from a keypair.
 */
export function extractPublicKey(keyPair: VfsKeyPair): VfsPublicKey {
  return {
    x25519PublicKey: keyPair.x25519PublicKey,
    mlKemPublicKey: keyPair.mlKemPublicKey
  };
}

/**
 * Encrypt data for a recipient using their public key.
 * Uses hybrid X25519 + ML-KEM encryption.
 *
 * @param plaintext The data to encrypt
 * @param recipientPublicKey The recipient's public key
 * @returns Encapsulated key material and ciphertext
 */
export function encryptForRecipient(
  plaintext: Uint8Array,
  recipientPublicKey: VfsPublicKey
): HybridEncapsulation {
  // Generate ephemeral X25519 keypair for this message
  const x25519EphemeralPrivate = x25519.utils.randomSecretKey();
  const x25519EphemeralPublic = x25519.getPublicKey(x25519EphemeralPrivate);

  // X25519 key exchange
  const x25519SharedSecret = x25519.getSharedSecret(
    x25519EphemeralPrivate,
    recipientPublicKey.x25519PublicKey
  );

  // ML-KEM encapsulation
  const { cipherText: mlKemCiphertext, sharedSecret: mlKemSharedSecret } =
    ml_kem768.encapsulate(recipientPublicKey.mlKemPublicKey);

  // Combine shared secrets using HKDF
  const combinedSecret = new Uint8Array(
    x25519SharedSecret.length + mlKemSharedSecret.length
  );
  combinedSecret.set(x25519SharedSecret, 0);
  combinedSecret.set(mlKemSharedSecret, x25519SharedSecret.length);

  const derivedKey = hkdf(
    sha256,
    combinedSecret,
    undefined,
    HKDF_INFO,
    DERIVED_KEY_LENGTH
  );

  // Encrypt with AES-256-GCM
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = gcm(derivedKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  // Zero out sensitive data
  x25519EphemeralPrivate.fill(0);
  x25519SharedSecret.fill(0);
  mlKemSharedSecret.fill(0);
  combinedSecret.fill(0);

  return {
    x25519EphemeralPublic,
    mlKemCiphertext,
    nonce,
    ciphertext
  };
}

/**
 * Decrypt data using your private key.
 *
 * @param encapsulation The encapsulated key material and ciphertext
 * @param recipientKeyPair Your keypair (with private keys)
 * @returns Decrypted plaintext
 */
export function decryptWithKeyPair(
  encapsulation: HybridEncapsulation,
  recipientKeyPair: VfsKeyPair
): Uint8Array {
  // X25519 key exchange (using ephemeral public from sender)
  const x25519SharedSecret = x25519.getSharedSecret(
    recipientKeyPair.x25519PrivateKey,
    encapsulation.x25519EphemeralPublic
  );

  // ML-KEM decapsulation
  const mlKemSharedSecret = ml_kem768.decapsulate(
    encapsulation.mlKemCiphertext,
    recipientKeyPair.mlKemPrivateKey
  );

  // Combine shared secrets using HKDF (same as encryption)
  const combinedSecret = new Uint8Array(
    x25519SharedSecret.length + mlKemSharedSecret.length
  );
  combinedSecret.set(x25519SharedSecret, 0);
  combinedSecret.set(mlKemSharedSecret, x25519SharedSecret.length);

  const derivedKey = hkdf(
    sha256,
    combinedSecret,
    undefined,
    HKDF_INFO,
    DERIVED_KEY_LENGTH
  );

  // Decrypt with AES-256-GCM
  const cipher = gcm(derivedKey, encapsulation.nonce);
  const plaintext = cipher.decrypt(encapsulation.ciphertext);

  // Zero out sensitive data
  x25519SharedSecret.fill(0);
  mlKemSharedSecret.fill(0);
  combinedSecret.fill(0);

  return plaintext;
}

/**
 * Wrap a symmetric key for a recipient.
 * This is the primary use case for VFS: sharing item session keys.
 *
 * @param sessionKey The symmetric key to wrap (typically 32 bytes for AES-256)
 * @param recipientPublicKey The recipient's public key
 * @returns Serialized encapsulation (base64-encoded for database storage)
 */
export function wrapKeyForRecipient(
  sessionKey: Uint8Array,
  recipientPublicKey: VfsPublicKey
): SerializedEncapsulation {
  const encapsulation = encryptForRecipient(sessionKey, recipientPublicKey);
  return serializeEncapsulation(encapsulation);
}

/**
 * Unwrap a symmetric key using your private key.
 *
 * @param wrappedKey Serialized encapsulation from wrapKeyForRecipient
 * @param recipientKeyPair Your keypair
 * @returns The original symmetric key
 */
export function unwrapKeyWithKeyPair(
  wrappedKey: SerializedEncapsulation,
  recipientKeyPair: VfsKeyPair
): Uint8Array {
  const encapsulation = deserializeEncapsulation(wrappedKey);
  return decryptWithKeyPair(encapsulation, recipientKeyPair);
}

// =============================================================================
// Serialization helpers (for database storage)
// =============================================================================

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Serialize a keypair to base64 for storage or transmission.
 *
 * IMPORTANT: This returns RAW (unencrypted) private keys in base64 format.
 * The private keys MUST be encrypted (e.g., with a password-derived key via Argon2)
 * before being stored in the database's `encrypted_private_keys` field.
 *
 * Usage flow:
 * 1. Generate keypair with generateKeyPair()
 * 2. Serialize with serializeKeyPair() -> raw base64 keys
 * 3. Encrypt the serialized private keys with user's password-derived key
 * 4. Store encrypted blob in encrypted_private_keys, public keys stored as-is
 */
export function serializeKeyPair(keyPair: VfsKeyPair): SerializedKeyPair {
  return {
    x25519PublicKey: toBase64(keyPair.x25519PublicKey),
    x25519PrivateKey: toBase64(keyPair.x25519PrivateKey),
    mlKemPublicKey: toBase64(keyPair.mlKemPublicKey),
    mlKemPrivateKey: toBase64(keyPair.mlKemPrivateKey)
  };
}

/**
 * Deserialize a keypair from storage.
 */
export function deserializeKeyPair(serialized: SerializedKeyPair): VfsKeyPair {
  return {
    x25519PublicKey: fromBase64(serialized.x25519PublicKey),
    x25519PrivateKey: fromBase64(serialized.x25519PrivateKey),
    mlKemPublicKey: fromBase64(serialized.mlKemPublicKey),
    mlKemPrivateKey: fromBase64(serialized.mlKemPrivateKey)
  };
}

/**
 * Serialize a public key for storage/transmission.
 */
export function serializePublicKey(
  publicKey: VfsPublicKey
): SerializedPublicKey {
  return {
    x25519PublicKey: toBase64(publicKey.x25519PublicKey),
    mlKemPublicKey: toBase64(publicKey.mlKemPublicKey)
  };
}

/**
 * Deserialize a public key from storage.
 */
export function deserializePublicKey(
  serialized: SerializedPublicKey
): VfsPublicKey {
  return {
    x25519PublicKey: fromBase64(serialized.x25519PublicKey),
    mlKemPublicKey: fromBase64(serialized.mlKemPublicKey)
  };
}

/**
 * Serialize an encapsulation for storage.
 */
export function serializeEncapsulation(
  encapsulation: HybridEncapsulation
): SerializedEncapsulation {
  return {
    x25519EphemeralPublic: toBase64(encapsulation.x25519EphemeralPublic),
    mlKemCiphertext: toBase64(encapsulation.mlKemCiphertext),
    nonce: toBase64(encapsulation.nonce),
    ciphertext: toBase64(encapsulation.ciphertext)
  };
}

/**
 * Deserialize an encapsulation from storage.
 */
export function deserializeEncapsulation(
  serialized: SerializedEncapsulation
): HybridEncapsulation {
  return {
    x25519EphemeralPublic: fromBase64(serialized.x25519EphemeralPublic),
    mlKemCiphertext: fromBase64(serialized.mlKemCiphertext),
    nonce: fromBase64(serialized.nonce),
    ciphertext: fromBase64(serialized.ciphertext)
  };
}

/**
 * Combine serialized public key parts into a single string for database storage.
 * Format: base64(x25519) + "." + base64(mlKem)
 */
export function combinePublicKey(publicKey: SerializedPublicKey): string {
  return `${publicKey.x25519PublicKey}.${publicKey.mlKemPublicKey}`;
}

/**
 * Split a combined public key string back into parts.
 */
export function splitPublicKey(combined: string): SerializedPublicKey {
  const [x25519PublicKey, mlKemPublicKey] = combined.split('.');
  if (!x25519PublicKey || !mlKemPublicKey) {
    throw new Error('Invalid combined public key format');
  }
  return { x25519PublicKey, mlKemPublicKey };
}

/**
 * Combine encapsulation into a single string for database storage.
 * Format: base64(x25519Eph) + "." + base64(mlKemCt) + "." + base64(nonce) + "." + base64(ct)
 */
export function combineEncapsulation(
  encapsulation: SerializedEncapsulation
): string {
  return [
    encapsulation.x25519EphemeralPublic,
    encapsulation.mlKemCiphertext,
    encapsulation.nonce,
    encapsulation.ciphertext
  ].join('.');
}

/**
 * Split a combined encapsulation string back into parts.
 */
export function splitEncapsulation(combined: string): SerializedEncapsulation {
  const parts = combined.split('.');
  if (parts.length !== 4) {
    throw new Error('Invalid combined encapsulation format');
  }
  const x25519EphemeralPublic = parts[0];
  const mlKemCiphertext = parts[1];
  const nonce = parts[2];
  const ciphertext = parts[3];
  if (!x25519EphemeralPublic || !mlKemCiphertext || !nonce || !ciphertext) {
    throw new Error('Invalid combined encapsulation format');
  }
  return {
    x25519EphemeralPublic,
    mlKemCiphertext,
    nonce,
    ciphertext
  };
}
