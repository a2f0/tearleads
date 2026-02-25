/**
 * Database helpers for AI conversation VFS operations.
 *
 * Extracted from useConversations to keep the hook under the file-size limit.
 * Contains session-key caching, CRDT payload building, and date formatting.
 */

import { asc, eq } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { aiMessages } from '@/db/schema';
import { ensureVfsKeyPair } from '@/hooks/vfs';
import { unwrapConversationSessionKey } from '@/lib/conversationCrypto';

const sessionKeyCache = new Map<string, Uint8Array>();

export async function getSessionKey(
  conversationId: string,
  encryptedSessionKey: string
): Promise<Uint8Array> {
  const cached = sessionKeyCache.get(conversationId);
  if (cached) {
    return cached;
  }

  const keyPair = await ensureVfsKeyPair();

  try {
    const sessionKey = await unwrapConversationSessionKey(
      encryptedSessionKey,
      keyPair
    );
    sessionKeyCache.set(conversationId, sessionKey);
    return sessionKey;
  } catch (error) {
    console.error('Failed to unwrap conversation session key:', error);
    throw new Error(
      'Cannot decrypt conversation - private keys not available. ' +
        'Please unlock your database or create a new conversation.'
    );
  }
}

export function cacheSessionKey(id: string, key: Uint8Array): void {
  sessionKeyCache.set(id, key);
}

export function getCachedSessionKey(id: string): Uint8Array | undefined {
  return sessionKeyCache.get(id);
}

export function evictSessionKey(id: string): void {
  const key = sessionKeyCache.get(id);
  if (key) {
    key.fill(0);
    sessionKeyCache.delete(id);
  }
}

export function clearConversationKeyCache(): void {
  for (const key of sessionKeyCache.values()) {
    key.fill(0);
  }
  sessionKeyCache.clear();
}

export async function buildCrdtPayload(
  conversationId: string,
  encryptedTitle: string,
  modelId: string | null
): Promise<Record<string, unknown>> {
  const db = getDatabase();
  const msgs = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.sequenceNumber));

  return {
    encryptedTitle,
    modelId,
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      encryptedContent: m.encryptedContent,
      modelId: m.modelId,
      sequenceNumber: m.sequenceNumber,
      createdAt:
        m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : String(m.createdAt)
    })),
    updatedAt: new Date().toISOString()
  };
}

export function toISOString(value: Date | string | number): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
