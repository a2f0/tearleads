import type { DecryptedAiConversation } from '@tearleads/shared';
import { desc, eq } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { aiConversations, vfsRegistry } from '@/db/schema';
import { decryptContent } from '@/lib/conversationCrypto';
import { getSessionKey, toISOString } from './conversationDb';

export async function loadDecryptedConversations(): Promise<
  DecryptedAiConversation[]
> {
  const db = getDatabase();
  const rows = await db
    .select({
      id: aiConversations.id,
      encryptedTitle: aiConversations.encryptedTitle,
      modelId: aiConversations.modelId,
      messageCount: aiConversations.messageCount,
      createdAt: aiConversations.createdAt,
      updatedAt: aiConversations.updatedAt,
      encryptedSessionKey: vfsRegistry.encryptedSessionKey
    })
    .from(aiConversations)
    .innerJoin(vfsRegistry, eq(aiConversations.id, vfsRegistry.id))
    .orderBy(desc(aiConversations.updatedAt));

  const decrypted: DecryptedAiConversation[] = [];
  for (const row of rows) {
    const encryptedFallback: DecryptedAiConversation = {
      id: row.id,
      title: '[Encrypted]',
      modelId: row.modelId,
      messageCount: row.messageCount,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt)
    };

    try {
      if (!row.encryptedSessionKey) {
        decrypted.push(encryptedFallback);
        continue;
      }

      const sessionKey = await getSessionKey(row.id, row.encryptedSessionKey);
      const title = await decryptContent(row.encryptedTitle, sessionKey);
      decrypted.push({
        id: row.id,
        title,
        modelId: row.modelId,
        messageCount: row.messageCount,
        createdAt: toISOString(row.createdAt),
        updatedAt: toISOString(row.updatedAt)
      });
    } catch (error) {
      console.error(`Failed to decrypt conversation ${row.id}:`, error);
      decrypted.push(encryptedFallback);
    }
  }

  return decrypted;
}
