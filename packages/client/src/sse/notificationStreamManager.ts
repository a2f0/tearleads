import {
  isRecord,
  type SSEConnectionState,
  type SSEMessage
} from '@tearleads/shared';

const SSE_RECONNECT_BASE_DELAY_MS = 1000;
const SSE_RECONNECT_MAX_DELAY_MS = 30000;

interface NotificationStreamEnvelope {
  event: string;
}

interface NotificationStreamManagerSnapshot {
  connectionState: SSEConnectionState;
  lastMessage: SSEMessage | null;
}

interface NotificationStreamConnectOptions {
  apiBaseUrl: string;
  channels: string[];
  token: string;
}

interface OpenNotificationEventStreamOptions {
  apiBaseUrl: string;
  channels: string[];
  token?: string | null;
  signal?: AbortSignal;
}

interface NotificationStreamManagerDependencies {
  openNotificationEventStream: (
    options: OpenNotificationEventStreamOptions
  ) => AsyncIterable<string>;
  isTokenExpired: (token: string) => boolean;
  tryRefreshToken: () => Promise<unknown> | unknown;
  computeReconnectDelayWithJitter?: (attempt: number) => number;
}

export interface NotificationStreamManager {
  connect: (options: NotificationStreamConnectOptions) => void;
  disconnect: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NotificationStreamManagerSnapshot;
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

export function computeReconnectDelayWithJitter(attempt: number): number {
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

export function createNotificationStreamManager(
  dependencies: NotificationStreamManagerDependencies
): NotificationStreamManager {
  let snapshot: NotificationStreamManagerSnapshot = {
    connectionState: 'disconnected',
    lastMessage: null
  };
  const listeners = new Set<() => void>();
  let abortController: AbortController | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let currentConfig: NotificationStreamConnectOptions | null = null;

  const emitChange = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setSnapshot = (
    nextSnapshot: NotificationStreamManagerSnapshot
  ): void => {
    if (
      snapshot.connectionState === nextSnapshot.connectionState &&
      snapshot.lastMessage === nextSnapshot.lastMessage
    ) {
      return;
    }
    snapshot = nextSnapshot;
    emitChange();
  };

  const clearReconnectTimeout = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  const disconnectInternal = (resetReconnectAttempt: boolean): void => {
    clearReconnectTimeout();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    setSnapshot({
      ...snapshot,
      connectionState: 'disconnected'
    });
    if (resetReconnectAttempt) {
      reconnectAttempt = 0;
    }
  };

  const handleError = (isAborted: boolean): void => {
    if (isAborted) {
      return;
    }

    abortController = null;

    const token = currentConfig?.token;
    if (token && dependencies.isTokenExpired(token)) {
      setSnapshot({
        ...snapshot,
        connectionState: 'connecting'
      });
      void dependencies.tryRefreshToken();
      return;
    }

    setSnapshot({
      ...snapshot,
      connectionState: 'disconnected'
    });

    const computeDelay =
      dependencies.computeReconnectDelayWithJitter ??
      computeReconnectDelayWithJitter;
    const delay = computeDelay(reconnectAttempt);
    reconnectAttempt += 1;

    reconnectTimeout = setTimeout(() => {
      if (!currentConfig) {
        return;
      }
      connect(currentConfig);
    }, delay);
  };

  const connect = (options: NotificationStreamConnectOptions): void => {
    currentConfig = {
      apiBaseUrl: options.apiBaseUrl,
      channels: [...options.channels],
      token: options.token
    };

    disconnectInternal(true);
    setSnapshot({
      ...snapshot,
      connectionState: 'connecting'
    });

    const streamConfig = currentConfig;
    const nextAbortController = new AbortController();
    abortController = nextAbortController;

    const startStream = async () => {
      try {
        for await (const payload of dependencies.openNotificationEventStream({
          apiBaseUrl: streamConfig.apiBaseUrl,
          channels: streamConfig.channels,
          token: streamConfig.token,
          signal: nextAbortController.signal
        })) {
          let parsedPayload: unknown;
          try {
            parsedPayload = JSON.parse(payload);
          } catch (error) {
            console.error('Failed to parse SSE message:', error);
            continue;
          }

          if (!isNotificationStreamEnvelope(parsedPayload)) {
            continue;
          }

          if (parsedPayload.event === 'connected') {
            setSnapshot({
              ...snapshot,
              connectionState: 'connected'
            });
            reconnectAttempt = 0;
            continue;
          }

          if (parsedPayload.event !== 'message') {
            continue;
          }

          if (isSseMessage(parsedPayload)) {
            setSnapshot({
              ...snapshot,
              lastMessage: {
                channel: parsedPayload.channel,
                message: parsedPayload.message
              }
            });
          } else {
            console.error(
              'Failed to parse SSE message: invalid shape',
              parsedPayload
            );
          }
        }

        handleError(nextAbortController.signal.aborted);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        handleError(false);
      }
    };

    void startStream();
  };

  const disconnect = (): void => {
    currentConfig = null;
    disconnectInternal(true);
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getSnapshot = (): NotificationStreamManagerSnapshot => snapshot;

  return {
    connect,
    disconnect,
    subscribe,
    getSnapshot
  };
}
