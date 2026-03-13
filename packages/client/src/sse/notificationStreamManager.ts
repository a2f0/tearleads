import {
  isRecord,
  parseJsonWithByteArrays,
  type SSEConnectionState,
  type SSEMessage
} from '@tearleads/shared';
import {
  areSameChannels,
  diffChannels,
  normalizeChannels
} from './notificationStreamChannelUtils';

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
  addChannels: (channels: string[]) => void;
  removeChannels: (channels: string[]) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NotificationStreamManagerSnapshot;
}

type StreamRestartReason =
  | 'manual-connect'
  | 'scheduled-reconnect'
  | 'channel-registration-add'
  | 'channel-registration-remove';

type StreamErrorReason = 'stream-ended' | 'stream-error';

interface NotificationStreamManagerLogPayload {
  event: string;
  [key: string]: unknown;
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

function logManagerEvent(payload: NotificationStreamManagerLogPayload): void {
  console.info('[notification-stream-manager]', payload);
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
  let activeChannels: string[] = [];
  let baseChannels: string[] = [];
  let activeStreamEpoch = 0;
  const additionalChannelRefCounts = new Map<string, number>();
  let pendingChannelReconnect = false;
  let pendingChannelReconnectReason:
    | 'channel-registration-add'
    | 'channel-registration-remove'
    | null = null;

  const emitChange = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setSnapshot = (
    partialSnapshot: Partial<NotificationStreamManagerSnapshot>
  ): void => {
    const nextSnapshot = {
      ...snapshot,
      ...partialSnapshot
    };
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

  const getEffectiveChannels = (): string[] => {
    const additionalChannels = [...additionalChannelRefCounts.keys()];
    return normalizeChannels([...baseChannels, ...additionalChannels]);
  };

  const scheduleChannelReconnect = (
    reason: 'channel-registration-add' | 'channel-registration-remove'
  ): void => {
    pendingChannelReconnectReason = reason;
    if (pendingChannelReconnect) {
      return;
    }
    pendingChannelReconnect = true;
    queueMicrotask(() => {
      pendingChannelReconnect = false;
      const queuedReason = pendingChannelReconnectReason;
      pendingChannelReconnectReason = null;
      if (
        !queuedReason ||
        !currentConfig ||
        snapshot.connectionState === 'disconnected'
      ) {
        return;
      }
      connectInternal(currentConfig, queuedReason);
    });
  };

  const disconnectInternal = (resetReconnectAttempt: boolean): void => {
    clearReconnectTimeout();
    activeStreamEpoch += 1;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    setSnapshot({
      connectionState: 'disconnected',
      lastMessage: resetReconnectAttempt ? null : snapshot.lastMessage
    });
    if (resetReconnectAttempt) {
      reconnectAttempt = 0;
    }
  };

  const handleError = ({
    isAborted,
    reason,
    streamEpoch
  }: {
    isAborted: boolean;
    reason: StreamErrorReason;
    streamEpoch: number;
  }): void => {
    if (isAborted || streamEpoch !== activeStreamEpoch) {
      return;
    }

    abortController = null;

    const token = currentConfig?.token;
    if (token && dependencies.isTokenExpired(token)) {
      logManagerEvent({
        event: 'reconnect-deferred-token-refresh',
        reason
      });
      setSnapshot({
        connectionState: 'connecting'
      });
      void dependencies.tryRefreshToken();
      return;
    }

    setSnapshot({
      connectionState: 'disconnected'
    });

    const computeDelay =
      dependencies.computeReconnectDelayWithJitter ??
      computeReconnectDelayWithJitter;
    const attempt = reconnectAttempt + 1;
    const delay = computeDelay(reconnectAttempt);
    reconnectAttempt = attempt;

    logManagerEvent({
      event: 'reconnect-scheduled',
      reason,
      attempt,
      delayMs: delay
    });

    reconnectTimeout = setTimeout(() => {
      if (!currentConfig) {
        return;
      }
      connectInternal(currentConfig, 'scheduled-reconnect');
    }, delay);
  };

  const connectInternal = (
    options: NotificationStreamConnectOptions,
    reason: StreamRestartReason
  ): void => {
    const nextBaseChannels = normalizeChannels(options.channels);

    const nextConfig: NotificationStreamConnectOptions = {
      apiBaseUrl: options.apiBaseUrl,
      channels: nextBaseChannels,
      token: options.token
    };

    const previousConfig = currentConfig;
    const previousEffectiveChannels = activeChannels;
    baseChannels = nextBaseChannels;
    const nextEffectiveChannels = getEffectiveChannels();
    const configChanged =
      !previousConfig ||
      previousConfig.apiBaseUrl !== nextConfig.apiBaseUrl ||
      previousConfig.token !== nextConfig.token;
    const effectiveChannelsChanged = !areSameChannels(
      activeChannels,
      nextEffectiveChannels
    );

    currentConfig = nextConfig;

    if (effectiveChannelsChanged) {
      const { added, removed } = diffChannels(
        previousEffectiveChannels,
        nextEffectiveChannels
      );
      logManagerEvent({
        event: 'channel-set-changed',
        reason,
        previousChannels: previousEffectiveChannels,
        nextChannels: nextEffectiveChannels,
        addedChannels: added,
        removedChannels: removed
      });
    }

    if (
      !configChanged &&
      !effectiveChannelsChanged &&
      snapshot.connectionState !== 'disconnected'
    ) {
      return;
    }

    disconnectInternal(true);
    setSnapshot({
      connectionState: 'connecting'
    });

    const streamConfig = nextConfig;
    const streamChannels = nextEffectiveChannels;
    activeChannels = streamChannels;
    const nextAbortController = new AbortController();
    abortController = nextAbortController;
    const streamEpoch = activeStreamEpoch;

    const startStream = async () => {
      try {
        for await (const payload of dependencies.openNotificationEventStream({
          apiBaseUrl: streamConfig.apiBaseUrl,
          channels: streamChannels,
          token: streamConfig.token,
          signal: nextAbortController.signal
        })) {
          if (streamEpoch !== activeStreamEpoch) {
            return;
          }

          let parsedPayload: unknown;
          try {
            parsedPayload = parseJsonWithByteArrays(payload);
          } catch (error) {
            console.error('Failed to parse SSE message:', error);
            continue;
          }

          if (!isNotificationStreamEnvelope(parsedPayload)) {
            continue;
          }

          if (parsedPayload.event === 'connected') {
            setSnapshot({
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
              connectionState: 'connected',
              lastMessage: {
                channel: parsedPayload.channel,
                message: parsedPayload.message
              }
            });
            reconnectAttempt = 0;
          } else {
            console.error(
              'Failed to parse SSE message: invalid shape',
              parsedPayload
            );
          }
        }

        handleError({
          isAborted: nextAbortController.signal.aborted,
          reason: 'stream-ended',
          streamEpoch
        });
      } catch (error) {
        if (
          nextAbortController.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        handleError({
          isAborted: false,
          reason: 'stream-error',
          streamEpoch
        });
      }
    };

    void startStream();
  };

  const connect = (options: NotificationStreamConnectOptions): void => {
    connectInternal(options, 'manual-connect');
  };

  const disconnect = (): void => {
    currentConfig = null;
    activeChannels = [];
    baseChannels = [];
    disconnectInternal(true);
  };

  const addChannels = (channels: string[]): void => {
    const normalizedChannels = normalizeChannels(channels);
    let effectiveChannelsChanged = false;

    for (const channel of normalizedChannels) {
      const currentCount = additionalChannelRefCounts.get(channel) ?? 0;
      const nextCount = currentCount + 1;
      additionalChannelRefCounts.set(channel, nextCount);
      if (currentCount === 0) {
        effectiveChannelsChanged = true;
      }
    }

    if (
      !effectiveChannelsChanged ||
      !currentConfig ||
      snapshot.connectionState === 'disconnected'
    ) {
      return;
    }

    scheduleChannelReconnect('channel-registration-add');
  };

  const removeChannels = (channels: string[]): void => {
    const normalizedChannels = normalizeChannels(channels);
    let effectiveChannelsChanged = false;

    for (const channel of normalizedChannels) {
      const currentCount = additionalChannelRefCounts.get(channel);
      if (!currentCount) {
        continue;
      }
      if (currentCount <= 1) {
        additionalChannelRefCounts.delete(channel);
        effectiveChannelsChanged = true;
        continue;
      }
      additionalChannelRefCounts.set(channel, currentCount - 1);
    }

    if (
      !effectiveChannelsChanged ||
      !currentConfig ||
      snapshot.connectionState === 'disconnected'
    ) {
      return;
    }

    scheduleChannelReconnect('channel-registration-remove');
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getSnapshot = (): NotificationStreamManagerSnapshot => snapshot;

  return {
    connect,
    disconnect,
    addChannels,
    removeChannels,
    subscribe,
    getSnapshot
  };
}
