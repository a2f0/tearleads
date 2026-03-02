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
import {
  API_BASE_URL,
  openNotificationEventStream,
  tryRefreshToken
} from '@/lib/api';
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

interface NotificationStreamEnvelope {
  event: string;
}

function isNotificationStreamEnvelope(
  value: unknown
): value is NotificationStreamEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value['event'] === 'string';
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

const SSE_RECONNECT_BASE_DELAY_MS = 1000;
const SSE_RECONNECT_MAX_DELAY_MS = 30000;

function computeReconnectDelayWithJitter(attempt: number): number {
  if (attempt <= 0) {
    return SSE_RECONNECT_BASE_DELAY_MS;
  }

  const exponentialDelay = Math.min(
    SSE_RECONNECT_BASE_DELAY_MS * 2 ** attempt,
    SSE_RECONNECT_MAX_DELAY_MS
  );
  const jitterFloor = Math.floor(exponentialDelay / 2);
  const jitterRange = Math.max(0, exponentialDelay - jitterFloor);
  return jitterFloor + Math.floor(Math.random() * (jitterRange + 1));
}

export function SSEProvider({
  children,
  autoConnect = true,
  channels = ['broadcast']
}: SSEProviderProps) {
  // component-complexity: allow -- stream auth, reconnect, and lifecycle paths are intentionally centralized.
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
      const apiBaseUrl = API_BASE_URL;
      if (!apiBaseUrl) {
        console.error('API_BASE_URL not configured');
        return;
      }

      channelsRef.current = [...channelsToUse];
      disconnect();
      setConnectionState('connecting');

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
        const delay = computeReconnectDelayWithJitter(
          reconnectAttemptRef.current
        );
        reconnectAttemptRef.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect(channelsToUse);
        }, delay);
      };

      const startStream = async () => {
        try {
          for await (const payload of openNotificationEventStream({
            apiBaseUrl,
            channels: channelsToUse,
            token,
            signal: abortController.signal
          })) {
            let parsedPayload: unknown;
            try {
              parsedPayload = JSON.parse(payload);
            } catch (err) {
              console.error('Failed to parse SSE message:', err);
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

            if (parsedPayload.event !== 'message') {
              continue;
            }

            if (isSseMessage(parsedPayload)) {
              setLastMessage({
                channel: parsedPayload.channel,
                message: parsedPayload.message
              });
            } else {
              console.error(
                'Failed to parse SSE message: invalid shape',
                parsedPayload
              );
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
