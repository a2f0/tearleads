import type { ShareTargetSearchResult } from '@tearleads/shared';
import { api } from '@/lib/api';

export interface RecipientPublicKeyResolver {
  resolvePublicKey(userId: string): Promise<{
    publicKeyId: string;
    publicEncryptionKey: string;
  } | null>;
}

interface ShareTargetWithKey extends ShareTargetSearchResult {
  publicEncryptionKey?: string;
}

/**
 * In-memory cache for recipient public keys.
 * Keys are cached to avoid repeated API calls for the same recipient.
 */
const keyCache = new Map<
  string,
  { publicKeyId: string; publicEncryptionKey: string }
>();

/**
 * Clear the recipient key cache (e.g., on logout).
 */
export function clearRecipientKeyCache(): void {
  keyCache.clear();
}

/**
 * Resolve a recipient's public key by user ID.
 * Uses the VFS share targets search API to find the user's public key.
 */
async function resolvePublicKeyFromApi(
  userId: string
): Promise<{ publicKeyId: string; publicEncryptionKey: string } | null> {
  try {
    // Search for the user in share targets
    const response = await api.vfs.searchShareTargets(userId, 'user');

    // Find the exact match (cast to include optional publicEncryptionKey)
    const targets = response.results as ShareTargetWithKey[];
    const target = targets.find((t) => t.id === userId);
    if (!target) {
      return null;
    }

    // The share target should have the user's public encryption key
    // This requires the API to return publicEncryptionKey for users
    if (!target.publicEncryptionKey) {
      console.warn(
        `User ${userId} found in share targets but no public key available`
      );
      return null;
    }

    // Derive publicKeyId from a hash of the key (same as UserKeyProvider)
    const publicKeyId = await derivePublicKeyId(target.publicEncryptionKey);

    return {
      publicKeyId,
      publicEncryptionKey: target.publicEncryptionKey
    };
  } catch (error) {
    console.error(`Failed to resolve public key for user ${userId}:`, error);
    return null;
  }
}

/**
 * Derive a stable public key ID from a public encryption key string.
 */
async function derivePublicKeyId(publicEncryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(publicEncryptionKey);
  const hash = await crypto.subtle.digest('SHA-256', data);
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

export function createRecipientPublicKeyResolver(): RecipientPublicKeyResolver {
  return {
    async resolvePublicKey(
      userId: string
    ): Promise<{ publicKeyId: string; publicEncryptionKey: string } | null> {
      // Check cache first
      const cached = keyCache.get(userId);
      if (cached) {
        return cached;
      }

      const result = await resolvePublicKeyFromApi(userId);
      if (result) {
        keyCache.set(userId, result);
      }

      return result;
    }
  };
}

/**
 * Create a RecipientPublicKeyResolver with pre-populated keys.
 * Useful for testing or when keys are known ahead of time.
 */
export function createRecipientPublicKeyResolverWithKeys(
  knownKeys: Map<string, { publicKeyId: string; publicEncryptionKey: string }>
): RecipientPublicKeyResolver {
  return {
    async resolvePublicKey(
      userId: string
    ): Promise<{ publicKeyId: string; publicEncryptionKey: string } | null> {
      return knownKeys.get(userId) ?? null;
    }
  };
}
