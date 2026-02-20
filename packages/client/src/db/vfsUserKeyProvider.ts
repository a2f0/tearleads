import type { AuthUser, VfsKeyPair } from '@tearleads/shared';
import { ensureVfsKeyPair, getVfsPublicKey } from '@/hooks/vfs';

export interface UserKeyProvider {
  getUserKeyPair(): Promise<VfsKeyPair>;
  getUserId(): Promise<string>;
  getPublicKeyId(): Promise<string>;
}

/**
 * Cache entry that stores the public key ID scoped to a specific user.
 * This prevents returning stale key IDs after user account switches.
 */
let cachedPublicKeyId: { userId: string; keyId: string } | null = null;

/**
 * Ensures Uint8Array is typed with ArrayBuffer (not ArrayBufferLike).
 * WebCrypto APIs require BufferSource which expects ArrayBuffer, not SharedArrayBuffer.
 */
function asBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data as Uint8Array<ArrayBuffer>;
}

/**
 * Derives a stable public key ID from the user's public key.
 * Uses SHA-256 hash truncated to 16 bytes, encoded as base64url.
 */
async function derivePublicKeyId(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', asBufferSource(publicKey));
  const hashBytes = new Uint8Array(hash).slice(0, 16);
  return uint8ArrayToBase64Url(hashBytes);
}

function uint8ArrayToBase64Url(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function createUserKeyProvider(
  getUser: () => AuthUser | null
): UserKeyProvider {
  return {
    async getUserKeyPair(): Promise<VfsKeyPair> {
      return ensureVfsKeyPair();
    },

    async getUserId(): Promise<string> {
      const user = getUser();
      if (!user) {
        throw new Error('User is not authenticated');
      }
      return user.id;
    },

    async getPublicKeyId(): Promise<string> {
      const user = getUser();
      if (!user) {
        throw new Error('User is not authenticated');
      }

      // Return cached value only if it belongs to the current user
      if (cachedPublicKeyId && cachedPublicKeyId.userId === user.id) {
        return cachedPublicKeyId.keyId;
      }

      const publicKey = await getVfsPublicKey();
      if (!publicKey) {
        throw new Error('VFS public key not available');
      }

      // Combine public keys and derive an ID
      const combined = new Uint8Array(
        publicKey.x25519PublicKey.length + publicKey.mlKemPublicKey.length
      );
      combined.set(publicKey.x25519PublicKey, 0);
      combined.set(publicKey.mlKemPublicKey, publicKey.x25519PublicKey.length);

      const keyId = await derivePublicKeyId(combined);
      cachedPublicKeyId = { userId: user.id, keyId };
      return keyId;
    }
  };
}

/**
 * Clear the cached public key ID (e.g., on logout or user change).
 */
export function clearUserKeyProviderCache(): void {
  cachedPublicKeyId = null;
}
