/**
 * Hook for managing messages in a group.
 * Handles fetching, decrypting, and sending encrypted messages.
 */

import type { MlsMessage, MlsMessagesResponse } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useMlsChatApi, useMlsChatUser } from '../context/index.js';
import type { DecryptedMessage, MlsClient } from '../lib/index.js';
import { requestMlsRpc } from './mlsConnectRpc.js';

interface UseGroupMessagesResult {
  messages: DecryptedMessage[];
  isLoading: boolean;
  isSending: boolean;
  error: Error | null;
  sendMessage: (plaintext: string, contentType?: string) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  refresh: () => Promise<void>;
}

const PAGE_SIZE = 50;

export function useGroupMessages(
  groupId: string | null,
  client: MlsClient | null
): UseGroupMessagesResult {
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();
  const { userId } = useMlsChatUser();

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const cursorRef = useRef<string | null>(null);

  const decryptMessage = useCallback(
    async (msg: MlsMessage): Promise<DecryptedMessage | null> => {
      if (!client || !groupId) return null;

      try {
        const ciphertext = Uint8Array.from(atob(msg.ciphertext), (c) =>
          c.charCodeAt(0)
        );
        const { plaintext, senderId } = await client.decryptMessage(
          groupId,
          ciphertext
        );

        return {
          id: msg.id,
          groupId: msg.groupId,
          senderUserId: senderId,
          senderEmail: msg.senderEmail,
          plaintext: new TextDecoder().decode(plaintext),
          contentType: msg.contentType,
          sentAt: new Date(msg.sentAt),
          isOwnMessage: senderId === userId
        };
      } catch {
        // Return a placeholder for messages that can't be decrypted
        return {
          id: msg.id,
          groupId: msg.groupId,
          senderUserId: msg.senderUserId,
          senderEmail: msg.senderEmail,
          plaintext: '[Unable to decrypt message]',
          contentType: msg.contentType,
          sentAt: new Date(msg.sentAt),
          isOwnMessage: msg.senderUserId === userId
        };
      }
    },
    [client, groupId, userId]
  );

  const fetchMessages = useCallback(
    async (cursor?: string) => {
      if (!groupId) return;

      setIsLoading(true);
      setError(null);

      try {
        const requestBody: Record<string, unknown> = {
          groupId,
          limit: PAGE_SIZE
        };
        if (cursor) {
          requestBody['cursor'] = cursor;
        }

        const data = await requestMlsRpc<MlsMessagesResponse>({
          context: { apiBaseUrl, getAuthHeader },
          method: 'GetGroupMessages',
          requestBody,
          errorMessage: 'Failed to fetch messages'
        });

        // Decrypt all messages
        const decrypted = await Promise.all(data.messages.map(decryptMessage));
        const validMessages = decrypted.filter(
          (m): m is DecryptedMessage => m !== null
        );

        if (cursor) {
          setMessages((prev) => [...prev, ...validMessages]);
        } else {
          setMessages(validMessages);
        }

        cursorRef.current = data.cursor ?? null;
        setHasMore(data.hasMore);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to fetch messages')
        );
      } finally {
        setIsLoading(false);
      }
    },
    [groupId, apiBaseUrl, getAuthHeader, decryptMessage]
  );

  const sendMessage = useCallback(
    async (plaintext: string, contentType = 'text/plain') => {
      if (!groupId || !client) {
        throw new Error('Group or client not initialized');
      }

      setIsSending(true);
      setError(null);

      try {
        const plaintextBytes = new TextEncoder().encode(plaintext);
        const ciphertext = await client.encryptMessage(groupId, plaintextBytes);
        const epoch = client.getGroupEpoch(groupId);
        if (epoch === undefined) {
          throw new Error('Group state not initialized');
        }

        const data = await requestMlsRpc<{ message: MlsMessage }>({
          context: { apiBaseUrl, getAuthHeader },
          method: 'SendGroupMessage',
          requestBody: {
            groupId,
            json: JSON.stringify({
              ciphertext: btoa(
                String.fromCharCode.apply(null, Array.from(ciphertext))
              ),
              contentType,
              epoch,
              messageType: 'application'
            })
          },
          errorMessage: 'Failed to send message'
        });

        // Add the sent message optimistically (we know the plaintext)
        const newMessage: DecryptedMessage = {
          id: data.message.id,
          groupId: data.message.groupId,
          senderUserId: userId,
          plaintext,
          contentType,
          sentAt: new Date(data.message.sentAt),
          isOwnMessage: true
        };

        setMessages((prev) => [newMessage, ...prev]);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to send message')
        );
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [groupId, client, userId, apiBaseUrl, getAuthHeader]
  );

  const loadMore = useCallback(async () => {
    if (hasMore && cursorRef.current) {
      await fetchMessages(cursorRef.current);
    }
  }, [hasMore, fetchMessages]);

  // Handle incoming messages from realtime hook
  const addIncomingMessage = useCallback(
    async (encryptedMessage: MlsMessage) => {
      const decrypted = await decryptMessage(encryptedMessage);
      if (decrypted) {
        setMessages((prev) => {
          // Avoid duplicates
          if (prev.some((m) => m.id === decrypted.id)) {
            return prev;
          }
          return [decrypted, ...prev];
        });
      }
    },
    [decryptMessage]
  );

  useEffect(() => {
    if (groupId && client) {
      cursorRef.current = null;
      fetchMessages();
    }
  }, [groupId, client, fetchMessages]);

  // Expose addIncomingMessage for use by realtime hook
  useEffect(() => {
    if (!groupId) {
      return;
    }

    type HandlerMap = Map<string, (msg: MlsMessage) => void>;
    const windowWithHandler = window as unknown as {
      __mlsMessageHandler?: HandlerMap;
    };
    windowWithHandler.__mlsMessageHandler =
      windowWithHandler.__mlsMessageHandler ?? new Map();
    windowWithHandler.__mlsMessageHandler.set(groupId, addIncomingMessage);

    return () => {
      windowWithHandler.__mlsMessageHandler?.delete(groupId);
    };
  }, [groupId, addIncomingMessage]);

  return {
    messages,
    isLoading,
    isSending,
    error,
    sendMessage,
    loadMore,
    hasMore,
    refresh: () => {
      cursorRef.current = null;
      return fetchMessages();
    }
  };
}
