/**
 * Hook for MLS real-time message delivery via Connect notifications streaming.
 * Subscribes to group channels and handles incoming messages.
 */

import { openNotificationEventStream } from '@tearleads/api-client/notificationStream';
import type { MlsMessage, MlsMessageType } from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useMlsChatApi, useMlsChatUser } from '../context/index.js';
import type { MlsClient, SseConnectionState } from '../lib/index.js';
import { uploadGroupStateSnapshot } from './groupStateSync.js';

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

interface NotificationStreamEnvelope {
  event: string;
}

interface NotificationStreamMessageEnvelope extends NotificationStreamEnvelope {
  channel: string;
  message: unknown;
}

function isNotificationStreamEnvelope(
  value: unknown
): value is NotificationStreamEnvelope {
  return isRecord(value) && typeof value['event'] === 'string';
}

function isNotificationStreamMessageEnvelope(
  value: unknown
): value is NotificationStreamMessageEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNotificationStreamEnvelope(value) &&
    value['event'] === 'message' &&
    typeof value['channel'] === 'string' &&
    'message' in value
  );
}

function normalizeToken(authHeaderValue: string | null | undefined): string {
  if (!authHeaderValue) {
    return '';
  }
  const trimmed = authHeaderValue.trim();
  if (trimmed.startsWith('Bearer ')) {
    return trimmed.slice('Bearer '.length).trim();
  }
  return trimmed;
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
function isMlsMessage(value: unknown): value is MlsMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['groupId'] === 'string' &&
    typeof value['epoch'] === 'number' &&
    typeof value['ciphertext'] === 'string' &&
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

function decodeBase64Bytes(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function dispatchRealtimeMessage(groupId: string, message: MlsMessage): void {
  const handlers = Reflect.get(globalThis, '__mlsMessageHandler');
  if (!(handlers instanceof Map)) {
    return;
  }

  const handler = handlers.get(groupId);
  if (typeof handler === 'function') {
    handler(message);
  }
}

function notifyMembershipChange(groupId: string): void {
  const handlers = Reflect.get(globalThis, '__mlsMembershipHandler');
  if (!(handlers instanceof Map)) {
    return;
  }

  const handler = handlers.get(groupId);
  if (typeof handler === 'function') {
    handler();
  }
}

function triggerWelcomeRefresh(): void {
  const handler = Reflect.get(globalThis, '__mlsWelcomeRefreshHandler');
  if (typeof handler === 'function') {
    void Promise.resolve(handler());
  }
}

export function useMlsRealtime(client: MlsClient | null): UseMlsRealtimeResult {
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();
  const { userId } = useMlsChatUser();

  const [connectionState, setConnectionState] =
    useState<SseConnectionState>('disconnected');
  const [subscribedGroups, setSubscribedGroups] = useState<Set<string>>(
    new Set()
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const reconnectAttemptRef = useRef(0);

  const connect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!client) {
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('connecting');

    const groupChannels = Array.from(subscribedGroups).map(
      (groupId) => `mls:group:${groupId}`
    );
    const channels = [`mls:user:${userId}`, ...groupChannels];
    const authValue = getAuthHeader?.();
    const token = normalizeToken(authValue);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const handleError = (isAborted: boolean) => {
      if (isAborted) return;

      setConnectionState('error');
      abortControllerRef.current = null;

      // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s max
      const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 30000);
      reconnectAttemptRef.current++;

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    const startStream = async () => {
      try {
        for await (const payload of openNotificationEventStream({
          apiBaseUrl,
          channels,
          token,
          signal: abortController.signal
        })) {
          let parsedPayload: unknown;
          try {
            parsedPayload = JSON.parse(payload);
          } catch {
            continue;
          }

          if (!isNotificationStreamEnvelope(parsedPayload)) {
            continue;
          }

          if (parsedPayload.event === 'connected') {
            setConnectionState('connected');
            reconnectAttemptRef.current = 0;
            continue;
          }

          if (!isNotificationStreamMessageEnvelope(parsedPayload)) {
            continue;
          }

          const messageEnvelope = parsedPayload.message;
          if (!isSseMessageEnvelope(messageEnvelope)) {
            continue;
          }

          if (messageEnvelope.type === 'mls:message') {
            if (!isMlsMessage(messageEnvelope.payload)) {
              continue;
            }

            const message = messageEnvelope.payload;
            if (message.messageType === 'application') {
              dispatchRealtimeMessage(message.groupId, message);
              continue;
            }

            if (
              message.messageType !== 'commit' ||
              !client.hasGroup(message.groupId) ||
              message.senderUserId === userId
            ) {
              continue;
            }

            const commitBytes = decodeBase64Bytes(message.ciphertext);
            if (!commitBytes) {
              continue;
            }

            client
              .processCommit(message.groupId, commitBytes)
              .then(async () => {
                try {
                  await uploadGroupStateSnapshot({
                    groupId: message.groupId,
                    client,
                    apiBaseUrl,
                    getAuthHeader
                  });
                } catch (uploadError) {
                  console.warn(
                    `Failed to upload MLS state for group ${message.groupId}:`,
                    uploadError
                  );
                }
              })
              .catch(() => {
                // Commit processing failed - may need state refresh
              });
            continue;
          }

          if (
            messageEnvelope.type === 'mls:member_added' ||
            messageEnvelope.type === 'mls:member_removed'
          ) {
            if (!isGroupMembershipPayload(messageEnvelope.payload)) {
              continue;
            }
            notifyMembershipChange(messageEnvelope.payload.groupId);
            continue;
          }

          if (messageEnvelope.type === 'mls:welcome') {
            if (!isWelcomePayload(messageEnvelope.payload)) {
              continue;
            }
            triggerWelcomeRefresh();
          }
        }

        handleError(abortController.signal.aborted);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        handleError(false);
      }
    };

    void startStream();
  }, [apiBaseUrl, getAuthHeader, subscribedGroups, client, userId]);

  const subscribe = useCallback((groupId: string) => {
    setSubscribedGroups((prev) => {
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
  }, []);

  const unsubscribe = useCallback((groupId: string) => {
    setSubscribedGroups((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }, []);

  // Reconnect when subscribed groups change
  useEffect(() => {
    connect();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return {
    connectionState,
    subscribe,
    unsubscribe,
    subscribedGroups
  };
}
