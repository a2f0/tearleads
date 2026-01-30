/**
 * Hook for MLS real-time message delivery via SSE.
 * Subscribes to group channels and handles incoming messages.
 */

import type { MlsMessage } from '@rapid/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useMlsChatApi } from '../context/index.js';
import type { SseConnectionState } from '../lib/index.js';
import type { MlsClient } from '../lib/mls.js';

interface UseMlsRealtimeResult {
  connectionState: SseConnectionState;
  subscribe: (groupId: string) => void;
  unsubscribe: (groupId: string) => void;
  subscribedGroups: Set<string>;
}

export function useMlsRealtime(client: MlsClient | null): UseMlsRealtimeResult {
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();

  const [connectionState, setConnectionState] =
    useState<SseConnectionState>('disconnected');
  const [subscribedGroups, setSubscribedGroups] = useState<Set<string>>(
    new Set()
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    if (subscribedGroups.size === 0) {
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('connecting');

    // Build channel list for SSE subscription
    const channels = Array.from(subscribedGroups)
      .map((id) => `mls:group:${id}`)
      .join(',');

    // Build SSE URL with auth
    const authValue = getAuthHeader?.();
    const params = new URLSearchParams({ channels });
    if (authValue) {
      params.set('auth', authValue);
    }

    const eventSource = new EventSource(`${apiBaseUrl}/sse?${params}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnectionState('connected');
    };

    eventSource.onerror = () => {
      setConnectionState('error');
      eventSource.close();

      // Reconnect after delay
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string;
          payload: unknown;
        };

        if (data.type === 'mls:message') {
          const message = data.payload as MlsMessage;

          // Dispatch to message handler if registered
          const handlers = (
            window as unknown as {
              __mlsMessageHandler?: Map<string, (msg: MlsMessage) => void>;
            }
          ).__mlsMessageHandler;

          if (handlers?.has(message.groupId)) {
            handlers.get(message.groupId)?.(message);
          }
        } else if (data.type === 'mls:commit') {
          // Handle commit messages (epoch updates)
          const { groupId, commit } = data.payload as {
            groupId: string;
            commit: string;
          };

          if (client?.hasGroup(groupId)) {
            const commitBytes = Uint8Array.from(atob(commit), (c) =>
              c.charCodeAt(0)
            );
            client.processCommit(groupId, commitBytes).catch(() => {
              // Commit processing failed - may need state refresh
            });
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }, [apiBaseUrl, getAuthHeader, subscribedGroups, client]);

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
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
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
