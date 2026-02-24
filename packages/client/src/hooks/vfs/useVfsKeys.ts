/**
 * VFS key management for file registration.
 *
 * Manages the user's VFS keypair lifecycle:
 * - Checks for existing keys on the server
 * - Generates new keypairs if needed
 * - Encrypts private keys with a recovery password from auth login/register
 * - Stores public keys and encrypted private keys on server
 * - Wraps session keys for file registration
 */

import {
  buildVfsPublicEncryptionKey,
  combineEncapsulation,
  decryptVfsPrivateKeysWithRawKey,
  deserializePublicKey,
  encryptVfsPrivateKeysWithRawKey,
  generateKeyPair,
  type SerializedKeyPair,
  serializeKeyPair,
  splitPublicKey,
  type VfsKeyPair,
  type VfsKeySetupRequest,
  type VfsObjectType,
  type VfsPublicKey,
  wrapKeyForRecipient
} from '@tearleads/shared';
import { api } from '@/lib/api';

// In-memory cache for the decrypted VFS keypair
let cachedKeyPair: VfsKeyPair | null = null;
let cachedRecoveryKeyMaterial: Uint8Array | null = null;

function isVfsKeysNotSetupError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('404') || message.includes('vfs keys not set up');
}

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
 * Derive a fixed-size recovery key from password for in-memory use.
 * Keeps plaintext password out of long-lived globals.
 */
function deriveRecoveryKeyMaterial(password: string): Uint8Array {
  const digestInput = new TextEncoder().encode(password);
  const digest = new Uint8Array(32);

  for (let index = 0; index < digestInput.length; index += 1) {
    const slot = index % digest.length;
    const mixed = digest[slot] ^ digestInput[index];
    digest[slot] = ((mixed << 5) | (mixed >> 3)) & 0xff;
  }

  digestInput.fill(0);
  return digest;
}

/**
 * Set or clear the in-memory recovery key material for this session.
 */
export function setVfsRecoveryPassword(password: string | null): void {
  if (!password || password.trim().length === 0) {
    if (cachedRecoveryKeyMaterial) {
      cachedRecoveryKeyMaterial.fill(0);
      cachedRecoveryKeyMaterial = null;
    }
    return;
  }

  if (cachedRecoveryKeyMaterial) {
    cachedRecoveryKeyMaterial.fill(0);
  }
  cachedRecoveryKeyMaterial = deriveRecoveryKeyMaterial(password);
}

/**
 * Convert a base64 string to Uint8Array.
 */
function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Encrypt the private keys with the account recovery password.
 * Returns base64-encoded encrypted blob.
 */
async function encryptPrivateKeys(
  serializedKeyPair: SerializedKeyPair,
  recoveryPassword: string
): Promise<{ encryptedBlob: string; argon2Salt: string }> {
  if (!recoveryPassword.trim()) {
    throw new Error('Recovery password is required');
  }

  const recoveryKeyMaterial = deriveRecoveryKeyMaterial(recoveryPassword);
  const bundle = await encryptVfsPrivateKeysWithRawKey(
    serializedKeyPair,
    recoveryKeyMaterial
  );
  recoveryKeyMaterial.fill(0);
  return {
    encryptedBlob: bundle.encryptedPrivateKeys,
    argon2Salt: bundle.argon2Salt
  };
}

/**
 * Build a VFS key setup payload locally for account onboarding.
 * This does not persist anything to the server.
 */
export async function createVfsKeySetupPayloadForOnboarding(
  recoveryPassword: string
): Promise<VfsKeySetupRequest> {
  const keyPair = generateKeyPair();
  const serialized = serializeKeyPair(keyPair);
  const { encryptedBlob, argon2Salt } = await encryptPrivateKeys(
    serialized,
    recoveryPassword
  );

  return {
    publicEncryptionKey: buildVfsPublicEncryptionKey(keyPair),
    // publicSigningKey omitted - not yet implemented
    encryptedPrivateKeys: encryptedBlob,
    argon2Salt
  };
}

/**
 * Decrypt private keys with the account recovery password.
 */
async function decryptPrivateKeys(
  encryptedBlob: string
): Promise<{
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
}> {
  if (!cachedRecoveryKeyMaterial) {
    throw new Error(
      'VFS key recovery requires re-authentication. Please log out and log in again.'
    );
  }

  return decryptVfsPrivateKeysWithRawKey(
    encryptedBlob,
    cachedRecoveryKeyMaterial
  );
}

/**
 * Generate a new VFS keypair, encrypt it, and store on server.
 */
async function generateAndStoreKeys(): Promise<VfsKeyPair> {
  if (!cachedRecoveryKeyMaterial) {
    throw new Error(
      'VFS key recovery requires re-authentication. Please log out and log in again.'
    );
  }

  // Generate a new keypair
  const keyPair = generateKeyPair();
  const serialized = serializeKeyPair(keyPair);

  // Encrypt private keys with in-memory recovery key material.
  const { encryptedPrivateKeys: encryptedBlob, argon2Salt } =
    await encryptVfsPrivateKeysWithRawKey(serialized, cachedRecoveryKeyMaterial);

  // Combine public keys for server storage
  const publicEncryptionKey = buildVfsPublicEncryptionKey(keyPair);

  // Store on server
  await api.vfs.setupKeys({
    publicEncryptionKey,
    // publicSigningKey omitted - not yet implemented
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
type FetchedKeys = { keyPair: VfsKeyPair; hasPrivateKeys: boolean } | null;

async function fetchAndDecryptKeys(): Promise<FetchedKeys> {
  try {
    const response = await api.vfs.getMyKeys();

    // Parse public keys from server
    const publicKey = splitPublicKey(response.publicEncryptionKey);

    const x25519PublicKey = fromBase64(publicKey.x25519PublicKey);
    const mlKemPublicKey = fromBase64(publicKey.mlKemPublicKey);

    if (response.encryptedPrivateKeys && response.argon2Salt) {
      try {
        const decrypted = await decryptPrivateKeys(
          response.encryptedPrivateKeys
        );
        const keyPair: VfsKeyPair = {
          x25519PublicKey,
          x25519PrivateKey: fromBase64(decrypted.x25519PrivateKey),
          mlKemPublicKey,
          mlKemPrivateKey: fromBase64(decrypted.mlKemPrivateKey)
        };
        cachedKeyPair = keyPair;
        return { keyPair, hasPrivateKeys: true };
      } catch (error) {
        // Fall back to public-only keys when decryption fails.
        console.error(
          'Failed to decrypt VFS private keys, falling back to public-only:',
          error
        );
      }
    }

    // No private keys available - return a public-only keypair
    return {
      hasPrivateKeys: false,
      keyPair: {
        x25519PublicKey,
        x25519PrivateKey: new Uint8Array(32),
        mlKemPublicKey,
        mlKemPrivateKey: new Uint8Array(2400)
      }
    };
  } catch (error) {
    // 404 means no keys exist yet
    if (isVfsKeysNotSetupError(error)) {
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
      x25519PublicKey: existingKeys.keyPair.x25519PublicKey,
      mlKemPublicKey: existingKeys.keyPair.mlKemPublicKey
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
 * Ensure the full VFS keypair (including private keys) is available.
 * Throws if private keys cannot be retrieved/decrypted.
 */
export async function ensureVfsKeyPair(): Promise<VfsKeyPair> {
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  const existingKeys = await fetchAndDecryptKeys();
  if (!existingKeys) {
    throw new Error('VFS keys not set up');
  }

  if (!existingKeys.hasPrivateKeys) {
    throw new Error('VFS private keys not available');
  }

  cachedKeyPair = existingKeys.keyPair;
  return existingKeys.keyPair;
}

/**
 * Check if VFS keys exist on the server.
 */
export async function hasVfsKeys(): Promise<boolean> {
  try {
    await api.vfs.getMyKeys();
    return true;
  } catch (error) {
    if (isVfsKeysNotSetupError(error)) {
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

interface RegisterVfsItemWithCurrentKeysInput {
  id: string;
  objectType: VfsObjectType;
  registerOnServer?: boolean;
  sessionKey?: Uint8Array;
}

interface RegisterVfsItemWithCurrentKeysResult {
  sessionKey: Uint8Array;
  encryptedSessionKey: string;
}

/**
 * Ensure keys are available, wrap a session key, and optionally register the
 * item on the server in one call.
 */
export async function registerVfsItemWithCurrentKeys(
  input: RegisterVfsItemWithCurrentKeysInput
): Promise<RegisterVfsItemWithCurrentKeysResult> {
  const sessionKey = input.sessionKey ?? generateSessionKey();
  const encryptedSessionKey = await wrapSessionKey(sessionKey);

  if (input.registerOnServer ?? true) {
    await api.vfs.register({
      id: input.id,
      objectType: input.objectType,
      encryptedSessionKey
    });
  }

  return {
    sessionKey,
    encryptedSessionKey
  };
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
    if (isVfsKeysNotSetupError(error)) {
      return null;
    }
    throw error;
  }
}
