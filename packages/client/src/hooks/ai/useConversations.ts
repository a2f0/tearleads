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
import { loadDecryptedConversations } from './conversationQuery';
import {
  clearLastConversationId,
  readLastConversationId,
  saveLastConversationId
} from './conversationResumeStorage';
import { useConversationBootstrap } from './useConversationBootstrap';
import type {
  UseConversationsOptions,
  UseConversationsResult
} from './useConversationsTypes';

export function useConversations(
  options: UseConversationsOptions = {}
): UseConversationsResult {
  const {
    autoStart = false,
    resumeLastConversation = false,
    instanceId
  } = options;
  const [conversations, setConversations] = useState<DecryptedAiConversation[]>(
    []
  );
  const [loading, setLoading] = useState(true);
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
      const decrypted = await loadDecryptedConversations();
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

  useEffect(() => {
    if (!resumeLastConversation || !currentConversationId) {
      return;
    }
    saveLastConversationId(currentConversationId, instanceId);
  }, [currentConversationId, instanceId, resumeLastConversation]);

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

      if (resumeLastConversation) {
        saveLastConversationId(conversationId, instanceId);
      }

      void queueItemUpsertAndFlush({
        itemId: conversationId,
        objectType: 'conversation',
        payload: {
          encryptedTitle,
          modelId: null,
          messages: [],
          updatedAt: now.toISOString()
        },
        encryptedSessionKey
      }).catch((syncError) => {
        console.warn(
          'Conversation created locally but background sync failed:',
          syncError
        );
      });

      return conversationId;
    },
    [instanceId, resumeLastConversation]
  );

  const selectConversation = useCallback(
    async (id: string | null): Promise<void> => {
      if (id === null) {
        setCurrentConversationId(null);
        setCurrentMessages([]);
        setCurrentSessionKey(null);
        if (resumeLastConversation) {
          clearLastConversationId(instanceId);
        }
        return;
      }

      setError(null);
      setMessagesLoading(true);

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
          setCurrentConversationId(id);
          setCurrentMessages(decryptedMessages);
          setCurrentSessionKey(sessionKey);
          setError(null);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : 'Failed to load conversation'
          );
        }
      } finally {
        if (mountedRef.current) {
          setMessagesLoading(false);
        }
      }
    },
    [instanceId, resumeLastConversation]
  );

  useConversationBootstrap({
    autoStart,
    resumeLastConversation,
    instanceId,
    loading,
    messagesLoading,
    currentConversationId,
    conversations,
    createConversation,
    selectConversation,
    setInitializationError: (message: string) => {
      if (mountedRef.current) {
        setError(message);
      }
    }
  });

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
        if (resumeLastConversation) {
          const fallbackConversationId =
            conversations.find((conversation) => conversation.id !== id)?.id ??
            null;
          if (fallbackConversationId) {
            saveLastConversationId(fallbackConversationId, instanceId);
          } else {
            clearLastConversationId(instanceId);
          }
        }
        return;
      }

      if (resumeLastConversation) {
        const savedConversationId = readLastConversationId(instanceId);
        if (savedConversationId === id) {
          if (currentConversationId) {
            saveLastConversationId(currentConversationId, instanceId);
          } else {
            clearLastConversationId(instanceId);
          }
        }
      }
    },
    [conversations, currentConversationId, instanceId, resumeLastConversation]
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

      const latestSequenceRows = await getDatabase()
        .select({ sequenceNumber: aiMessages.sequenceNumber })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, currentConversationId))
        .orderBy(desc(aiMessages.sequenceNumber))
        .limit(1);
      const sequenceNumber = (latestSequenceRows[0]?.sequenceNumber ?? 0) + 1;

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
    [currentConversationId, currentSessionKey]
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
