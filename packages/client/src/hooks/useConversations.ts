/**
 * Hook for managing AI conversations.
 *
 * Provides CRUD operations for conversations with client-side encryption.
 */

import { api } from '@tearleads/api-client';
import type {
  AiConversation,
  DecryptedAiConversation,
  DecryptedAiMessage
} from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createConversationEncryption,
  decryptConversation,
  decryptMessages,
  encryptMessage,
  encryptTitle,
  generateTitleFromMessage,
  unwrapConversationSessionKey
} from '@/lib/conversationCrypto';
import { ensureVfsKeyPair } from './useVfsKeys';

export interface ConversationWithKey {
  conversation: DecryptedAiConversation;
  sessionKey: Uint8Array;
}

export interface UseConversationsResult {
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

// Cache session keys by conversation ID
const sessionKeyCache = new Map<string, Uint8Array>();

/**
 * Unwrap a session key for a conversation.
 * Uses cache to avoid repeated crypto operations.
 *
 * Note: Requires the user's private keys to be available (database unlocked).
 */
async function getSessionKey(
  conversation: AiConversation
): Promise<Uint8Array> {
  const cached = sessionKeyCache.get(conversation.id);
  if (cached) {
    return cached;
  }

  const keyPair = await ensureVfsKeyPair();

  try {
    const sessionKey = await unwrapConversationSessionKey(
      conversation.encryptedSessionKey,
      keyPair
    );
    sessionKeyCache.set(conversation.id, sessionKey);
    return sessionKey;
  } catch (error) {
    // If unwrapping fails, we can't decrypt the conversation.
    console.error('Failed to unwrap conversation session key:', error);
    throw new Error(
      'Cannot decrypt conversation - private keys not available. ' +
        'Please unlock your database or create a new conversation.'
    );
  }
}

/**
 * Clear the session key cache (e.g., on logout).
 */
export function clearConversationKeyCache(): void {
  for (const key of sessionKeyCache.values()) {
    key.fill(0);
  }
  sessionKeyCache.clear();
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

  // Track mounted state
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch conversations list
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.ai.listConversations({ limit: 100 });

      // Decrypt conversations that we have session keys for
      const decrypted: DecryptedAiConversation[] = [];

      for (const conv of response.conversations) {
        try {
          // Check if we have the session key cached
          const cachedKey = sessionKeyCache.get(conv.id);
          if (cachedKey) {
            const dec = await decryptConversation(conv, cachedKey);
            decrypted.push(dec);
          } else {
            // For conversations without cached keys, show placeholder
            decrypted.push({
              id: conv.id,
              userId: conv.userId,
              organizationId: conv.organizationId,
              title: '[Encrypted]',
              modelId: conv.modelId,
              messageCount: conv.messageCount,
              createdAt: conv.createdAt,
              updatedAt: conv.updatedAt
            });
          }
        } catch {
          // If decryption fails, show placeholder
          decrypted.push({
            id: conv.id,
            userId: conv.userId,
            organizationId: conv.organizationId,
            title: '[Encrypted]',
            modelId: conv.modelId,
            messageCount: conv.messageCount,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt
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

  // Initial fetch
  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  // Create a new conversation
  const createConversation = useCallback(
    async (firstMessage?: string): Promise<string> => {
      setError(null);
      const title = firstMessage
        ? generateTitleFromMessage(firstMessage)
        : 'New Conversation';

      const { encryptedTitle, encryptedSessionKey, sessionKey } =
        await createConversationEncryption(title);

      const response = await api.ai.createConversation({
        encryptedTitle,
        encryptedSessionKey
      });

      const conv = response.conversation;

      // Cache the session key
      sessionKeyCache.set(conv.id, sessionKey);

      // Decrypt and add to list
      const decrypted = await decryptConversation(conv, sessionKey);

      setConversations((prev) => [decrypted, ...prev]);
      setCurrentConversationId(conv.id);
      setCurrentMessages([]);
      setCurrentSessionKey(sessionKey);

      return conv.id;
    },
    []
  );

  // Select a conversation (loads messages)
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
        const response = await api.ai.getConversation(id);

        // Get session key
        let sessionKey = sessionKeyCache.get(id);
        if (!sessionKey) {
          // Try to get from VFS keys
          sessionKey = await getSessionKey(response.conversation);
        }

        // Decrypt messages
        const decryptedMessages = await decryptMessages(
          response.messages,
          sessionKey
        );

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

  // Rename a conversation
  const renameConversation = useCallback(
    async (id: string, title: string): Promise<void> => {
      const sessionKey = sessionKeyCache.get(id);
      if (!sessionKey) {
        throw new Error('Cannot rename - session key not available');
      }

      const encryptedTitle = await encryptTitle(title, sessionKey);

      await api.ai.updateConversation(id, { encryptedTitle });

      // Update local state
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
    },
    []
  );

  // Delete a conversation
  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      await api.ai.deleteConversation(id);

      // Clear from cache
      const key = sessionKeyCache.get(id);
      if (key) {
        key.fill(0);
        sessionKeyCache.delete(id);
      }

      // Update local state
      setConversations((prev) => prev.filter((c) => c.id !== id));

      // Clear current if it was the deleted one
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentMessages([]);
        setCurrentSessionKey(null);
      }
    },
    [currentConversationId]
  );

  // Add a message to the current conversation
  const addMessage = useCallback(
    async (
      role: 'user' | 'assistant',
      content: string,
      modelId?: string
    ): Promise<void> => {
      if (!currentConversationId || !currentSessionKey) {
        throw new Error('No conversation selected');
      }

      const encryptedContent = await encryptMessage(content, currentSessionKey);

      const response = await api.ai.addMessage(currentConversationId, {
        role,
        encryptedContent,
        ...(modelId ? { modelId } : {})
      });

      // Add decrypted message to local state
      const decryptedMessage: DecryptedAiMessage = {
        id: response.message.id,
        conversationId: response.message.conversationId,
        role: response.message.role,
        content,
        modelId: response.message.modelId,
        sequenceNumber: response.message.sequenceNumber,
        createdAt: response.message.createdAt
      };

      setCurrentMessages((prev) => [...prev, decryptedMessage]);

      // Update conversation in list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConversationId
            ? {
                ...c,
                messageCount: response.conversation.messageCount,
                updatedAt: response.conversation.updatedAt
              }
            : c
        )
      );
    },
    [currentConversationId, currentSessionKey]
  );

  // Clear current conversation state
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
