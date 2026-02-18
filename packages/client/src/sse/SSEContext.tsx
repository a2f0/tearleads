import { API_BASE_URL, tryRefreshToken } from '@tearleads/api-client';
import {
  isRecord,
  type SSEConnectionState,
  type SSEMessage
} from '@tearleads/shared';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isJwtExpired } from '@/lib/jwt';

interface SSEContextValue {
  connectionState: SSEConnectionState;
  lastMessage: SSEMessage | null;
  connect: (channels?: string[]) => void;
  disconnect: () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

interface SSEProviderProps {
  children: ReactNode;
  autoConnect?: boolean;
  channels?: string[];
}

function isSseMessage(value: unknown): value is SSEMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value['channel'] !== 'string') {
    return false;
  }
  const message = value['message'];
  if (!isRecord(message)) {
    return false;
  }
  if (typeof message['type'] !== 'string') {
    return false;
  }
  if (!('payload' in message)) {
    return false;
  }
  return typeof message['timestamp'] === 'string';
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

export function SSEProvider({
  children,
  autoConnect = true,
  channels = ['broadcast']
}: SSEProviderProps) {
  const { isAuthenticated, isLoading, token } = useAuth();
  const [connectionState, setConnectionState] =
    useState<SSEConnectionState>('disconnected');
  const [lastMessage, setLastMessage] = useState<SSEMessage | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const reconnectAttemptRef = useRef(0);
  const channelsRef = useRef(channels);
  const prevChannelsRef = useRef<string[]>(channels);
  const prevTokenRef = useRef<string | null>(token);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setConnectionState('disconnected');
    reconnectAttemptRef.current = 0;
  }, [clearReconnectTimeout]);

  const connect = useCallback(
    (channelsToUse: string[] = channelsRef.current) => {
      if (!token) {
        return;
      }
      if (!API_BASE_URL) {
        console.error('API_BASE_URL not configured');
        return;
      }

      disconnect();
      setConnectionState('connecting');

      const url = new URL(`${API_BASE_URL}/sse`);
      url.searchParams.set('channels', channelsToUse.join(','));

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const handleError = (isAborted: boolean) => {
        if (isAborted) return;

        abortControllerRef.current = null;

        // Check if this is likely an auth error (token expired)
        if (token && isJwtExpired(token)) {
          // Token expired - set to 'connecting' while we attempt refresh
          // This allows the token-change effect to reconnect after refresh succeeds
          // If refresh fails, isAuthenticated becomes false and we stay disconnected
          setConnectionState('connecting');
          void tryRefreshToken();
          return;
        }

        // Network error or other issue - set disconnected and use exponential backoff
        setConnectionState('disconnected');
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 30000);
        reconnectAttemptRef.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect(channelsToUse);
        }, delay);
      };

      const startStream = async () => {
        try {
          const response = await fetch(url.toString(), {
            headers: {
              Authorization: `Bearer ${token}`
            },
            signal: abortController.signal
          });

          if (!response.ok) {
            handleError(false);
            return;
          }

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

            for (const { event, data } of events) {
              if (event === 'connected') {
                setConnectionState('connected');
                reconnectAttemptRef.current = 0;
              } else if (event === 'message') {
                try {
                  const parsed = JSON.parse(data);
                  if (isSseMessage(parsed)) {
                    setLastMessage(parsed);
                  } else {
                    console.error(
                      'Failed to parse SSE message: invalid shape',
                      parsed
                    );
                  }
                } catch (err) {
                  console.error('Failed to parse SSE message:', err);
                }
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
    },
    [disconnect, token]
  );

  // Reconnect when channels change (if already connected)
  useEffect(() => {
    const channelsChanged =
      channels.length !== prevChannelsRef.current.length ||
      channels.some((ch, i) => ch !== prevChannelsRef.current[i]);

    prevChannelsRef.current = channels;
    channelsRef.current = channels;

    // Reconnect if channels changed and we're connected or connecting
    if (channelsChanged && connectionState !== 'disconnected') {
      connect(channels);
    }
  }, [channels, connectionState, connect]);

  // Reconnect when token changes (e.g., after token refresh)
  // Only needed when autoConnect is false, since the autoConnect effect
  // already handles reconnection when token/connect changes
  useEffect(() => {
    const tokenChanged = token !== prevTokenRef.current;
    prevTokenRef.current = token;

    // Only reconnect if not using autoConnect (autoConnect effect handles that case)
    if (
      !autoConnect &&
      tokenChanged &&
      token &&
      connectionState !== 'disconnected'
    ) {
      connect();
    }
  }, [autoConnect, token, connectionState, connect]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (autoConnect && isAuthenticated) {
      connect();
    } else if (!isAuthenticated) {
      // Only disconnect when user logs out, not when autoConnect is false
      // (manual connections should persist when autoConnect=false)
      disconnect();
    }
  }, [autoConnect, connect, disconnect, isAuthenticated, isLoading]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const value = useMemo<SSEContextValue>(
    () => ({
      connectionState,
      lastMessage,
      connect,
      disconnect
    }),
    [connectionState, lastMessage, connect, disconnect]
  );

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}

export function useSSE(): SSEContextValue {
  const context = useContext(SSEContext);
  if (!context) {
    throw new Error('useSSE must be used within an SSEProvider');
  }
  return context;
}

export function useSSEContext(): SSEContextValue | null {
  return useContext(SSEContext);
}
