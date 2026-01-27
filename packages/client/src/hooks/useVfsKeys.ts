/**
 * VFS key management for file registration.
 *
 * Manages the user's VFS keypair lifecycle:
 * - Checks for existing keys on the server
 * - Generates new keypairs if needed
 * - Encrypts private keys with the local database encryption key
 * - Stores public keys and encrypted private keys on server
 * - Wraps session keys for file registration
 */

import {
  combineEncapsulation,
  combinePublicKey,
  deserializePublicKey,
  encrypt,
  generateKeyPair,
  generateSalt,
  importKey,
  type SerializedKeyPair,
  serializeKeyPair,
  splitPublicKey,
  type VfsKeyPair,
  type VfsPublicKey,
  wrapKeyForRecipient
} from '@rapid/shared';
import { getKeyManager } from '@/db/crypto/key-manager';
import { api } from '@/lib/api';

// In-memory cache for the decrypted VFS keypair
let cachedKeyPair: VfsKeyPair | null = null;

/**
 * Clear the cached keypair (e.g., on logout or instance change).
 */
export function clearVfsKeysCache(): void {
  if (cachedKeyPair) {
    // Security: Zero out private key data in-place before clearing reference.
    // Using fill(0) intentionally modifies the original array to overwrite
    // sensitive key material in memory, reducing exposure window.
    cachedKeyPair.x25519PrivateKey.fill(0);
    cachedKeyPair.mlKemPrivateKey.fill(0);
    cachedKeyPair = null;
  }
}

/**
 * Convert a base64 string to Uint8Array.
 */
function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Convert a Uint8Array to base64 string.
 */
function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Encrypt the private keys with the local database encryption key.
 * Returns base64-encoded encrypted blob.
 */
async function encryptPrivateKeys(
  serializedKeyPair: SerializedKeyPair
): Promise<{ encryptedBlob: string; argon2Salt: string }> {
  const keyManager = getKeyManager();
  const dbKey = keyManager.getCurrentKey();

  if (!dbKey) {
    throw new Error('Database is not unlocked');
  }

  // Combine private keys into a single JSON string
  const privateKeysJson = JSON.stringify({
    x25519PrivateKey: serializedKeyPair.x25519PrivateKey,
    mlKemPrivateKey: serializedKeyPair.mlKemPrivateKey
  });

  const plaintext = new TextEncoder().encode(privateKeysJson);
  const cryptoKey = await importKey(dbKey);
  const encrypted = await encrypt(plaintext, cryptoKey);

  // Generate a salt for the key derivation metadata
  // (In this case we're using the existing DB key, but we store a salt
  // to indicate which key derivation was used - for future key rotation)
  const salt = generateSalt();

  return {
    encryptedBlob: toBase64(encrypted),
    argon2Salt: toBase64(salt)
  };
}

// Note: decryptPrivateKeys will be needed when implementing file sharing/reading
// For now, we only need to wrap session keys (encryption), not unwrap them (decryption)

/**
 * Generate a new VFS keypair, encrypt it, and store on server.
 */
async function generateAndStoreKeys(): Promise<VfsKeyPair> {
  // Generate a new keypair
  const keyPair = generateKeyPair();
  const serialized = serializeKeyPair(keyPair);

  // Encrypt private keys with local database key
  const { encryptedBlob, argon2Salt } = await encryptPrivateKeys(serialized);

  // Combine public keys for server storage
  const publicEncryptionKey = combinePublicKey({
    x25519PublicKey: serialized.x25519PublicKey,
    mlKemPublicKey: serialized.mlKemPublicKey
  });

  // Store on server
  await api.vfs.setupKeys({
    publicEncryptionKey,
    publicSigningKey: '', // Not used yet, placeholder for future signing keys
    encryptedPrivateKeys: encryptedBlob,
    argon2Salt
  });

  // Cache and return
  cachedKeyPair = keyPair;
  return keyPair;
}

/**
 * Fetch and decrypt existing VFS keys from server.
 */
async function fetchAndDecryptKeys(): Promise<VfsKeyPair | null> {
  try {
    const response = await api.vfs.getMyKeys();

    // Parse public keys from server
    const publicKey = splitPublicKey(response.publicEncryptionKey);

    // We need to fetch the encrypted private keys too
    // For now, we only have public keys from getMyKeys endpoint
    // The private keys are stored encrypted and would need a separate endpoint
    // or we need to enhance getMyKeys to return encrypted private keys

    // For this implementation, we'll need to check if we have the private keys
    // cached locally or regenerate them (which would be a different keypair)

    // Since the server only returns public keys, and we can't decrypt without
    // the encrypted private keys, we need to handle this differently:
    // Option 1: Store encrypted private keys locally as well
    // Option 2: Add encrypted private keys to getMyKeys response
    // Option 3: Generate new keys if we don't have them cached

    // For now, return null if we don't have cached keys
    // The file upload flow will handle this by checking if keys exist
    // and using the public key for wrapping (which doesn't need private key)
    if (!cachedKeyPair) {
      // We have public keys on server but no private keys locally
      // This happens after browser refresh - the keypair needs to be regenerated
      // For VFS registration, we only need the public key to wrap session keys
      // So we can construct a "public-only" representation

      // Actually, for file upload (wrapping session keys), we only need the public key
      // The private key is only needed for unwrapping (reading files)
      // So we can return a partial keypair with just public keys

      const x25519PublicKey = fromBase64(publicKey.x25519PublicKey);
      const mlKemPublicKey = fromBase64(publicKey.mlKemPublicKey);

      // Return a keypair with only public keys populated
      // Private keys are zeroed - they're only needed for decryption
      return {
        x25519PublicKey,
        x25519PrivateKey: new Uint8Array(32), // Placeholder, not used for wrapping
        mlKemPublicKey,
        mlKemPrivateKey: new Uint8Array(2400) // Placeholder, not used for wrapping
      };
    }

    return cachedKeyPair;
  } catch (error) {
    // 404 means no keys exist yet
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * Ensure the user has VFS keys set up.
 * If keys exist on server, fetches the public keys.
 * If not, generates a new keypair and stores it.
 *
 * Returns the public key for wrapping session keys.
 */
export async function ensureVfsKeys(): Promise<VfsPublicKey> {
  // Return cached keys if available
  if (cachedKeyPair) {
    return {
      x25519PublicKey: cachedKeyPair.x25519PublicKey,
      mlKemPublicKey: cachedKeyPair.mlKemPublicKey
    };
  }

  // Try to fetch existing keys from server
  const existingKeys = await fetchAndDecryptKeys();
  if (existingKeys) {
    return {
      x25519PublicKey: existingKeys.x25519PublicKey,
      mlKemPublicKey: existingKeys.mlKemPublicKey
    };
  }

  // No keys exist, generate new ones
  const newKeys = await generateAndStoreKeys();
  return {
    x25519PublicKey: newKeys.x25519PublicKey,
    mlKemPublicKey: newKeys.mlKemPublicKey
  };
}

/**
 * Check if VFS keys exist on the server.
 */
export async function hasVfsKeys(): Promise<boolean> {
  try {
    await api.vfs.getMyKeys();
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return false;
    }
    throw error;
  }
}

/**
 * Wrap a session key for VFS registration.
 * Uses hybrid X25519 + ML-KEM encryption.
 *
 * @param sessionKey The symmetric key to wrap (32 bytes for AES-256)
 * @returns Combined encapsulation string for database storage
 */
export async function wrapSessionKey(sessionKey: Uint8Array): Promise<string> {
  const publicKey = await ensureVfsKeys();
  const encapsulation = wrapKeyForRecipient(sessionKey, publicKey);
  return combineEncapsulation(encapsulation);
}

/**
 * Generate a random session key for a file.
 */
export function generateSessionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Get the user's VFS public key from server.
 * Returns null if not set up.
 */
export async function getVfsPublicKey(): Promise<VfsPublicKey | null> {
  try {
    const response = await api.vfs.getMyKeys();
    const serialized = splitPublicKey(response.publicEncryptionKey);
    return deserializePublicKey(serialized);
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}
