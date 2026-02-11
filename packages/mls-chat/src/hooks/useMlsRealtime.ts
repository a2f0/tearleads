/**
 * Hook for MLS real-time message delivery via SSE.
 * Subscribes to group channels and handles incoming messages.
 * Uses fetch + ReadableStream for header-based auth (more secure than query params).
 */

import type { MlsMessage } from '@tearleads/shared';
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

interface SSEEvent {
  event: string;
  data: string;
}

function parseSSEEvents(chunk: string, buffer: string): [SSEEvent[], string] {
  const combined = buffer + chunk;
  const events: SSEEvent[] = [];
  const blocks = combined.split('\n\n');

  // Last block may be incomplete
  const remaining = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) continue;

    let eventType = 'message';
    const dataParts: string[] = [];

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        // SSE spec: strip only a single leading space from the value
        let value = line.slice(5);
        if (value.startsWith(' ')) {
          value = value.slice(1);
        }
        dataParts.push(value);
      }
      // Ignore comments (lines starting with :) and other fields
    }

    // SSE spec: multiple data lines are joined with newlines
    const data = dataParts.join('\n');

    if (data || eventType !== 'message') {
      events.push({ event: eventType, data });
    }
  }

  return [events, remaining];
}

export function useMlsRealtime(client: MlsClient | null): UseMlsRealtimeResult {
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();

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

    if (subscribedGroups.size === 0) {
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('connecting');

    // Build channel list for SSE subscription
    const channels = Array.from(subscribedGroups)
      .map((id) => `mls:group:${id}`)
      .join(',');

    const url = new URL(`${apiBaseUrl}/sse`);
    url.searchParams.set('channels', channels);

    const authValue = getAuthHeader?.();
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
        const headers: HeadersInit = {};
        if (authValue) {
          headers['Authorization'] = authValue.startsWith('Bearer ')
            ? authValue
            : `Bearer ${authValue}`;
        }

        const response = await fetch(url.toString(), {
          headers,
          signal: abortController.signal
        });

        if (!response.ok) {
          handleError(false);
          return;
        }

        setConnectionState('connected');
        reconnectAttemptRef.current = 0;

        const reader = response.body?.getReader();
        if (!reader) {
          handleError(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            handleError(abortController.signal.aborted);
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const [events, remaining] = parseSSEEvents(chunk, buffer);
          buffer = remaining;

          for (const { data } of events) {
            try {
              const parsed = JSON.parse(data) as {
                type: string;
                payload: unknown;
              };

              if (parsed.type === 'mls:message') {
                const message = parsed.payload as MlsMessage;

                // Dispatch to message handler if registered
                const handlers = (
                  window as unknown as {
                    __mlsMessageHandler?: Map<
                      string,
                      (msg: MlsMessage) => void
                    >;
                  }
                ).__mlsMessageHandler;

                if (handlers?.has(message.groupId)) {
                  handlers.get(message.groupId)?.(message);
                }
              } else if (parsed.type === 'mls:commit') {
                // Handle commit messages (epoch updates)
                const { groupId, commit } = parsed.payload as {
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
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        handleError(false);
      }
    };

    void startStream();
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
