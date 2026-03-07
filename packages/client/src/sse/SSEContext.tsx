import type { SSEConnectionState, SSEMessage } from '@tearleads/shared';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  API_BASE_URL,
  openNotificationEventStream,
  tryRefreshToken
} from '@/lib/api';
import { isJwtExpired } from '@/lib/jwt';
import { createNotificationStreamManager } from './notificationStreamManager';

interface SSEContextValue {
  connectionState: SSEConnectionState;
  lastMessage: SSEMessage | null;
  connect: (channels?: string[]) => void;
  disconnect: () => void;
  addChannels: (channels: string[]) => void;
  removeChannels: (channels: string[]) => void;
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
  // component-complexity: allow -- stream auth, reconnect, and lifecycle paths are intentionally centralized.
  const { isAuthenticated, isLoading, token } = useAuth();
  const streamManager = useMemo(
    () =>
      createNotificationStreamManager({
        openNotificationEventStream,
        isTokenExpired: isJwtExpired,
        tryRefreshToken
      }),
    []
  );
  const { connectionState, lastMessage } = useSyncExternalStore(
    streamManager.subscribe,
    streamManager.getSnapshot,
    streamManager.getSnapshot
  );
  const channelsRef = useRef(channels);
  const prevChannelsRef = useRef<string[]>(channels);
  const prevTokenRef = useRef<string | null>(token);

  const disconnect = useCallback(() => {
    streamManager.disconnect();
  }, [streamManager]);

  const addChannels = useCallback(
    (channelsToAdd: string[]) => {
      streamManager.addChannels(channelsToAdd);
    },
    [streamManager]
  );

  const removeChannels = useCallback(
    (channelsToRemove: string[]) => {
      streamManager.removeChannels(channelsToRemove);
    },
    [streamManager]
  );

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
      streamManager.connect({
        apiBaseUrl,
        channels: channelsToUse,
        token
      });
    },
    [streamManager, token]
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
      disconnect,
      addChannels,
      removeChannels
    }),
    [
      connectionState,
      lastMessage,
      connect,
      disconnect,
      addChannels,
      removeChannels
    ]
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
