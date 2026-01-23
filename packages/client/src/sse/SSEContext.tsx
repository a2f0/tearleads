import type { SSEConnectionState, SSEMessage } from '@rapid/shared';
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
import { API_BASE_URL } from '@/lib/api';

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

export function SSEProvider({
  children,
  autoConnect = true,
  channels = ['broadcast']
}: SSEProviderProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const [connectionState, setConnectionState] =
    useState<SSEConnectionState>('disconnected');
  const [lastMessage, setLastMessage] = useState<SSEMessage | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const reconnectAttemptRef = useRef(0);
  const channelsRef = useRef(channels);
  const prevChannelsRef = useRef<string[]>(channels);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnectionState('disconnected');
    reconnectAttemptRef.current = 0;
  }, [clearReconnectTimeout]);

  const connect = useCallback(
    (channelsToUse: string[] = channelsRef.current) => {
      if (!isAuthenticated) {
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

      const eventSource = new EventSource(url.toString());
      eventSourceRef.current = eventSource;

      eventSource.addEventListener('connected', () => {
        setConnectionState('connected');
        reconnectAttemptRef.current = 0;
      });

      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data as string) as SSEMessage;
          setLastMessage(data);
        } catch (err) {
          console.error('Failed to parse SSE message:', err);
        }
      });

      eventSource.onerror = () => {
        eventSource.close();
        eventSourceRef.current = null;
        setConnectionState('disconnected');

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 30000);
        reconnectAttemptRef.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect(channelsToUse);
        }, delay);
      };
    },
    [disconnect, isAuthenticated]
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

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated) {
      disconnect();
      return;
    }

    if (autoConnect) {
      connect();
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
