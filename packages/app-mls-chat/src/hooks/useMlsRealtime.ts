/**
 * Hook for MLS real-time message delivery via shared realtime bridge.
 * Subscribes to group channels and handles incoming messages.
 */

import type { MlsBinaryMessage, MlsMessageType } from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import {
  useMlsChatRealtime,
  useMlsChatUser,
  useMlsRoutes
} from '../context/index.js';
import type { MlsClient, SseConnectionState } from '../lib/index.js';
import {
  recoverMissingGroupState,
  uploadGroupStateSnapshot
} from './groupStateSync.js';
import {
  dispatchRealtimeMessage,
  notifyMembershipChange,
  triggerWelcomeRefresh
} from './useMlsRealtimeNotifications.js';

interface UseMlsRealtimeResult {
  connectionState: SseConnectionState;
  subscribe: (groupId: string) => void;
  unsubscribe: (groupId: string) => void;
  subscribedGroups: Set<string>;
}

/** Parsed SSE message envelope */
interface SseMessageEnvelope {
  type: string;
  payload: unknown;
}

/** Group membership event payload from SSE */
interface GroupMembershipPayload {
  groupId: string;
}

/** Welcome event payload from SSE */
interface WelcomePayload {
  groupId: string;
  welcomeId: string;
}

/** Type guard for SSE message envelope */
function isSseMessageEnvelope(value: unknown): value is SseMessageEnvelope {
  return isRecord(value) && typeof value['type'] === 'string';
}

const VALID_MESSAGE_TYPES: MlsMessageType[] = [
  'application',
  'commit',
  'proposal'
];

function isValidMessageType(value: unknown): value is MlsMessageType {
  return (
    typeof value === 'string' &&
    VALID_MESSAGE_TYPES.some((messageType) => messageType === value)
  );
}

/** Type guard for MlsMessage payload */
function isMlsMessage(value: unknown): value is MlsBinaryMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['groupId'] === 'string' &&
    typeof value['epoch'] === 'number' &&
    value['ciphertext'] instanceof Uint8Array &&
    isValidMessageType(value['messageType']) &&
    typeof value['contentType'] === 'string' &&
    typeof value['sequenceNumber'] === 'number' &&
    typeof value['sentAt'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    (value['senderUserId'] === null ||
      typeof value['senderUserId'] === 'string')
  );
}

function isGroupMembershipPayload(
  value: unknown
): value is GroupMembershipPayload {
  return isRecord(value) && typeof value['groupId'] === 'string';
}

function isWelcomePayload(value: unknown): value is WelcomePayload {
  return (
    isRecord(value) &&
    typeof value['groupId'] === 'string' &&
    typeof value['welcomeId'] === 'string'
  );
}

export function useMlsRealtime(client: MlsClient | null): UseMlsRealtimeResult {
  const realtimeBridge = useMlsChatRealtime();
  const mlsRoutes = useMlsRoutes();
  const { userId } = useMlsChatUser();

  const [subscribedGroups, setSubscribedGroups] = useState<Set<string>>(
    new Set()
  );

  const connectionState: SseConnectionState = client
    ? realtimeBridge.connectionState
    : 'disconnected';

  const handleMessageEnvelope = useCallback(
    (messageEnvelope: SseMessageEnvelope) => {
      if (!client) {
        return;
      }

      if (messageEnvelope.type === 'mls:message') {
        if (!isMlsMessage(messageEnvelope.payload)) {
          return;
        }

        const message = messageEnvelope.payload;
        if (message.messageType === 'application') {
          dispatchRealtimeMessage(message.groupId, message);
          return;
        }

        if (
          message.messageType !== 'commit' ||
          !client.hasGroup(message.groupId) ||
          message.senderUserId === userId
        ) {
          return;
        }

        client
          .processCommit(message.groupId, message.ciphertext)
          .then(async () => {
            try {
              await uploadGroupStateSnapshot({
                groupId: message.groupId,
                client,
                mlsRoutes
              });
            } catch (uploadError) {
              console.warn(
                `Failed to upload MLS state for group ${message.groupId}:`,
                uploadError
              );
            }
          })
          .catch((error) => {
            console.warn(
              `[mls-chat] Failed to process commit for group ${message.groupId}. Local state may require recovery.`,
              error
            );
            void (async () => {
              try {
                await client.leaveGroup(message.groupId);
                await recoverMissingGroupState({
                  groupId: message.groupId,
                  client,
                  mlsRoutes
                });
              } catch (recoveryError) {
                console.warn(
                  `[mls-chat] Failed to recover commit state for group ${message.groupId}.`,
                  recoveryError
                );
              }
            })();
          });
        return;
      }

      if (
        messageEnvelope.type === 'mls:member_added' ||
        messageEnvelope.type === 'mls:member_removed'
      ) {
        if (!isGroupMembershipPayload(messageEnvelope.payload)) {
          return;
        }
        notifyMembershipChange(messageEnvelope.payload.groupId);
        return;
      }

      if (messageEnvelope.type === 'mls:welcome') {
        if (!isWelcomePayload(messageEnvelope.payload)) {
          return;
        }
        triggerWelcomeRefresh();
      }
    },
    [client, mlsRoutes, userId]
  );

  const subscribe = useCallback((groupId: string) => {
    setSubscribedGroups((prev) => {
      if (prev.has(groupId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
  }, []);

  const unsubscribe = useCallback((groupId: string) => {
    setSubscribedGroups((prev) => {
      if (!prev.has(groupId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!client) {
      return;
    }

    const groupChannels = Array.from(subscribedGroups).map(
      (groupId) => `mls:group:${groupId}`
    );
    const channels = [`mls:user:${userId}`, ...groupChannels];

    realtimeBridge.addChannels(channels);
    return () => {
      realtimeBridge.removeChannels(channels);
    };
  }, [client, realtimeBridge, subscribedGroups, userId]);

  useEffect(() => {
    if (!client) {
      return;
    }

    const latestMessage = realtimeBridge.lastMessage;
    if (!latestMessage || !isSseMessageEnvelope(latestMessage.message)) {
      return;
    }

    handleMessageEnvelope(latestMessage.message);
  }, [
    client,
    handleMessageEnvelope,
    realtimeBridge,
    realtimeBridge.lastMessage
  ]);

  return {
    connectionState,
    subscribe,
    unsubscribe,
    subscribedGroups
  };
}
