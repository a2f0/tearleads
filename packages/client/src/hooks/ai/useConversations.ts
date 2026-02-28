/**
 * Hook for managing AI conversations via local SQLite + VFS CRDT sync.
 *
 * Conversations are VFS objects (objectType: 'conversation') stored in vfs_registry.
 * Messages are materialized in the local ai_messages table and serialized
 * into the conversation's CRDT encrypted payload for replication.
 */

import type {
  DecryptedAiConversation,
  DecryptedAiMessage
} from '@tearleads/shared';
import { asc, desc, eq } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import { aiConversations, aiMessages, vfsRegistry } from '@/db/schema';
import { ensureVfsKeys, generateSessionKey, wrapSessionKey } from '@/hooks/vfs';
import {
  decryptContent,
  encryptContent,
  generateTitleFromMessage
} from '@/lib/conversationCrypto';
import {
  queueItemDeleteAndFlush,
  queueItemUpsertAndFlush
} from '@/lib/vfsItemSyncWriter';
import {
  buildCrdtPayload,
  cacheSessionKey,
  evictSessionKey,
  getCachedSessionKey,
  getSessionKey,
  toISOString
} from './conversationDb';

interface UseConversationsResult {
  conversations: DecryptedAiConversation[];
  loading: boolean;
  error: string | null;

  currentConversationId: string | null;
  currentMessages: DecryptedAiMessage[];
  currentSessionKey: Uint8Array | null;
  messagesLoading: boolean;

  createConversation: (firstMessage?: string) => Promise<string>;
  selectConversation: (id: string | null) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  addMessage: (
    role: 'user' | 'assistant',
    content: string,
    modelId?: string
  ) => Promise<void>;

  refetch: () => Promise<void>;
  clearCurrentConversation: () => void;
}

export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<DecryptedAiConversation[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [currentMessages, setCurrentMessages] = useState<DecryptedAiMessage[]>(
    []
  );
  const [currentSessionKey, setCurrentSessionKey] = useState<Uint8Array | null>(
    null
  );
  const [messagesLoading, setMessagesLoading] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
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
        try {
          if (row.encryptedSessionKey) {
            const sk = await getSessionKey(row.id, row.encryptedSessionKey);
            const title = await decryptContent(row.encryptedTitle, sk);
            decrypted.push({
              id: row.id,
              title,
              modelId: row.modelId,
              messageCount: row.messageCount,
              createdAt: toISOString(row.createdAt),
              updatedAt: toISOString(row.updatedAt)
            });
          } else {
            decrypted.push({
              id: row.id,
              title: '[Encrypted]',
              modelId: row.modelId,
              messageCount: row.messageCount,
              createdAt: toISOString(row.createdAt),
              updatedAt: toISOString(row.updatedAt)
            });
          }
        } catch (e) {
          console.error(`Failed to decrypt conversation ${row.id}:`, e);
          decrypted.push({
            id: row.id,
            title: '[Encrypted]',
            modelId: row.modelId,
            messageCount: row.messageCount,
            createdAt: toISOString(row.createdAt),
            updatedAt: toISOString(row.updatedAt)
          });
        }
      }

      if (mountedRef.current) {
        setConversations(decrypted);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error ? err.message : 'Failed to load conversations'
        );
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const createConversation = useCallback(
    async (firstMessage?: string): Promise<string> => {
      setError(null);
      const title = firstMessage
        ? generateTitleFromMessage(firstMessage)
        : 'New Conversation';

      await ensureVfsKeys();
      const sessionKey = generateSessionKey();
      const encryptedSessionKey = await wrapSessionKey(sessionKey);
      const encryptedTitle = await encryptContent(title, sessionKey);

      const conversationId = crypto.randomUUID();
      const now = new Date();

      await runLocalWrite(async () => {
        const db = getDatabase();
        await db.transaction(async (tx) => {
          await tx.insert(vfsRegistry).values({
            id: conversationId,
            objectType: 'conversation',
            ownerId: null,
            encryptedSessionKey,
            createdAt: now
          });

          await tx.insert(aiConversations).values({
            id: conversationId,
            encryptedTitle,
            modelId: null,
            messageCount: 0,
            createdAt: now,
            updatedAt: now
          });
        });
      });

      cacheSessionKey(conversationId, sessionKey);

      await queueItemUpsertAndFlush({
        itemId: conversationId,
        objectType: 'conversation',
        payload: {
          encryptedTitle,
          modelId: null,
          messages: [],
          updatedAt: now.toISOString()
        },
        encryptedSessionKey
      });

      const decrypted: DecryptedAiConversation = {
        id: conversationId,
        title,
        modelId: null,
        messageCount: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      setConversations((prev) => [decrypted, ...prev]);
      setCurrentConversationId(conversationId);
      setCurrentMessages([]);
      setCurrentSessionKey(sessionKey);

      return conversationId;
    },
    []
  );

  const selectConversation = useCallback(
    async (id: string | null): Promise<void> => {
      if (id === null) {
        setCurrentConversationId(null);
        setCurrentMessages([]);
        setCurrentSessionKey(null);
        return;
      }

      setError(null);
      setCurrentConversationId(id);
      setMessagesLoading(true);
      setCurrentMessages([]);

      try {
        const db = getDatabase();

        const regRow = await db
          .select({ encryptedSessionKey: vfsRegistry.encryptedSessionKey })
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, id))
          .limit(1);

        const encryptedSessionKey = regRow[0]?.encryptedSessionKey;
        if (!encryptedSessionKey) {
          throw new Error('Session key not found for conversation');
        }

        const sessionKey = await getSessionKey(id, encryptedSessionKey);

        const msgs = await db
          .select()
          .from(aiMessages)
          .where(eq(aiMessages.conversationId, id))
          .orderBy(asc(aiMessages.sequenceNumber));

        const decryptedMessages: DecryptedAiMessage[] = [];
        for (const msg of msgs) {
          const content = await decryptContent(
            msg.encryptedContent,
            sessionKey
          );
          decryptedMessages.push({
            id: msg.id,
            conversationId: msg.conversationId,
            role: msg.role as DecryptedAiMessage['role'],
            content,
            modelId: msg.modelId,
            sequenceNumber: msg.sequenceNumber,
            createdAt: toISOString(msg.createdAt)
          });
        }

        if (mountedRef.current) {
          setCurrentMessages(decryptedMessages);
          setCurrentSessionKey(sessionKey);
          setError(null);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : 'Failed to load conversation'
          );
          setCurrentMessages([]);
          setCurrentSessionKey(null);
        }
      } finally {
        if (mountedRef.current) {
          setMessagesLoading(false);
        }
      }
    },
    []
  );

  const renameConversation = useCallback(
    async (id: string, title: string): Promise<void> => {
      const sessionKey = getCachedSessionKey(id);
      if (!sessionKey) {
        throw new Error('Cannot rename - session key not available');
      }

      const newEncryptedTitle = await encryptContent(title, sessionKey);
      const now = new Date();

      await runLocalWrite(async () => {
        const db = getDatabase();
        await db
          .update(aiConversations)
          .set({ encryptedTitle: newEncryptedTitle, updatedAt: now })
          .where(eq(aiConversations.id, id));
      });

      const convRow = await getDatabase()
        .select({ modelId: aiConversations.modelId })
        .from(aiConversations)
        .where(eq(aiConversations.id, id))
        .limit(1);

      const payload = await buildCrdtPayload(
        id,
        newEncryptedTitle,
        convRow[0]?.modelId ?? null
      );
      await queueItemUpsertAndFlush({
        itemId: id,
        objectType: 'conversation',
        payload
      });

      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title, updatedAt: now.toISOString() } : c
        )
      );
    },
    []
  );

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      await runLocalWrite(async () => {
        const db = getDatabase();
        await db.delete(aiConversations).where(eq(aiConversations.id, id));
        await db.delete(vfsRegistry).where(eq(vfsRegistry.id, id));
      });

      await queueItemDeleteAndFlush({
        itemId: id,
        objectType: 'conversation'
      });

      evictSessionKey(id);

      setConversations((prev) => prev.filter((c) => c.id !== id));

      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentMessages([]);
        setCurrentSessionKey(null);
      }
    },
    [currentConversationId]
  );

  const addMessage = useCallback(
    async (
      role: 'user' | 'assistant',
      content: string,
      modelId?: string
    ): Promise<void> => {
      if (!currentConversationId || !currentSessionKey) {
        throw new Error('No conversation selected');
      }

      const encryptedContent = await encryptContent(content, currentSessionKey);
      const messageId = crypto.randomUUID();
      const now = new Date();

      const currentCount = currentMessages.length;
      const sequenceNumber = currentCount + 1;

      await runLocalWrite(async () => {
        const db = getDatabase();
        await db.transaction(async (tx) => {
          await tx.insert(aiMessages).values({
            id: messageId,
            conversationId: currentConversationId,
            role,
            encryptedContent,
            modelId: modelId ?? null,
            sequenceNumber,
            createdAt: now
          });

          await tx
            .update(aiConversations)
            .set({
              messageCount: sequenceNumber,
              updatedAt: now
            })
            .where(eq(aiConversations.id, currentConversationId));
        });
      });

      const convRow = await getDatabase()
        .select({
          encryptedTitle: aiConversations.encryptedTitle,
          modelId: aiConversations.modelId
        })
        .from(aiConversations)
        .where(eq(aiConversations.id, currentConversationId))
        .limit(1);

      if (convRow[0]) {
        const payload = await buildCrdtPayload(
          currentConversationId,
          convRow[0].encryptedTitle,
          convRow[0].modelId
        );
        await queueItemUpsertAndFlush({
          itemId: currentConversationId,
          objectType: 'conversation',
          payload
        });
      }

      const decryptedMessage: DecryptedAiMessage = {
        id: messageId,
        conversationId: currentConversationId,
        role,
        content,
        modelId: modelId ?? null,
        sequenceNumber,
        createdAt: now.toISOString()
      };

      setCurrentMessages((prev) => [...prev, decryptedMessage]);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConversationId
            ? {
                ...c,
                messageCount: sequenceNumber,
                updatedAt: now.toISOString()
              }
            : c
        )
      );
    },
    [currentConversationId, currentSessionKey, currentMessages.length]
  );

  const clearCurrentConversation = useCallback(() => {
    setCurrentConversationId(null);
    setCurrentMessages([]);
    setCurrentSessionKey(null);
  }, []);

  return {
    conversations,
    loading,
    error,
    currentConversationId,
    currentMessages,
    currentSessionKey,
    messagesLoading,
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    addMessage,
    refetch: fetchConversations,
    clearCurrentConversation
  };
}
