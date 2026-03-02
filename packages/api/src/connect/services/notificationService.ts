import {
  Code,
  ConnectError,
  type HandlerContext
} from '@connectrpc/connect';
import type { BroadcastMessage } from '@tearleads/shared';
import type { SubscribeRequest } from '@tearleads/shared/gen/tearleads/v1/notifications_pb';
import {
  filterAuthorizedChannels,
  normalizeRequestedChannels,
  parseBroadcastMessage
} from '../../lib/notificationChannels.js';
import { getRedisSubscriberClient } from '../../lib/redisPubSub.js';
import { getRequiredConnectAuthContext } from '../context.js';

const KEEPALIVE_INTERVAL_MS = 30000;

type NotificationSubscriberClient = ReturnType<
  Awaited<ReturnType<typeof getRedisSubscriberClient>>['duplicate']
>;

interface NotificationEventEnvelope {
  json: string;
}

function toConnectedEnvelope(
  channels: readonly string[]
): NotificationEventEnvelope {
  return {
    json: JSON.stringify({ event: 'connected', channels })
  };
}

function toKeepaliveEnvelope(): NotificationEventEnvelope {
  return {
    json: JSON.stringify({ event: 'keepalive' })
  };
}

function toMessageEnvelope(
  channel: string,
  message: BroadcastMessage
): NotificationEventEnvelope {
  return {
    json: JSON.stringify({
      event: 'message',
      channel,
      message
    })
  };
}

async function cleanupNotificationClient(
  client: NotificationSubscriberClient | null,
  channels: readonly string[]
): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await Promise.all(channels.map((channel) => client.unsubscribe(channel)));
  } catch (error) {
    console.error('Notification stream cleanup error:', error);
  }

  try {
    await client.quit();
  } catch (error) {
    console.error('Notification stream quit error:', error);
  }
}

function awaitQueuedEvent(
  queue: NotificationEventEnvelope[],
  signal: AbortSignal,
  setWakeupHandler: (handler: (() => void) | null) => void
): Promise<void> {
  if (queue.length > 0 || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      setWakeupHandler(null);
      resolve();
    };
    const onQueued = () => {
      signal.removeEventListener('abort', onAbort);
      setWakeupHandler(null);
      resolve();
    };
    setWakeupHandler(onQueued);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function initializeSubscriptionClient(
  channels: readonly string[],
  enqueue: (event: NotificationEventEnvelope) => void
): Promise<NotificationSubscriberClient> {
  const subscriber = await getRedisSubscriberClient();
  const client = subscriber.duplicate();
  await client.connect();

  const messageHandler = (message: string, channel: string) => {
    const parsedMessage = parseBroadcastMessage(message);
    if (!parsedMessage) {
      return;
    }
    enqueue(toMessageEnvelope(channel, parsedMessage));
  };

  for (const channel of channels) {
    await client.subscribe(channel, messageHandler);
  }

  return client;
}

export const notificationConnectService = {
  subscribe: async function* (
    request: SubscribeRequest,
    context: HandlerContext
  ): AsyncGenerator<NotificationEventEnvelope> {
    const authContext = getRequiredConnectAuthContext(context);
    if (!authContext) {
      throw new ConnectError('Unauthorized', Code.Unauthenticated);
    }

    const requestedChannels = normalizeRequestedChannels(request.channels);
    const channels = await filterAuthorizedChannels(
      requestedChannels,
      authContext.claims.sub
    );
    if (channels.length === 0) {
      throw new ConnectError('No authorized channels', Code.PermissionDenied);
    }

    const queue: NotificationEventEnvelope[] = [];
    let wakeupHandler: (() => void) | null = null;
    const wakeup = (): void => {
      if (!wakeupHandler) {
        return;
      }
      const resolve = wakeupHandler;
      wakeupHandler = null;
      resolve();
    };
    const enqueue = (event: NotificationEventEnvelope): void => {
      queue.push(event);
      wakeup();
    };

    yield toConnectedEnvelope(channels);

    let client: NotificationSubscriberClient | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    try {
      client = await initializeSubscriptionClient(channels, enqueue);
      keepaliveTimer = setInterval(() => {
        enqueue(toKeepaliveEnvelope());
      }, KEEPALIVE_INTERVAL_MS);

      while (!context.signal.aborted) {
        await awaitQueuedEvent(queue, context.signal, (handler) => {
          wakeupHandler = handler;
        });
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) {
            yield next;
          }
        }
      }
    } catch (error) {
      if (!context.signal.aborted) {
        console.error('Notification stream setup failure', error);
        throw new ConnectError(
          'Failed to establish notification stream',
          Code.Unavailable
        );
      }
    } finally {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
      }
      wakeup();
      await cleanupNotificationClient(client, channels);
    }
  }
};
