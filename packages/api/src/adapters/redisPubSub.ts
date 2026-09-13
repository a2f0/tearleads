import type { PublishedRealtimeEvent } from "../realtime/publishedRealtimeEvents";
import {
  clearInMemoryRedisPubSub,
  inMemoryRedisAddListener,
  inMemoryRedisPublish,
  isInMemoryRedisEnabled,
} from "./inMemoryRedis";
import { createRedisClient } from "./redisClient";

const CHANNEL = "events";

type RedisClient = ReturnType<typeof createRedisClient>;

type EventListener = (message: string) => void;

const listeners = new Set<EventListener>();
const reconnectListeners = new Set<() => void>();

let publisher: RedisClient | null = null;
let subscriber: RedisClient | null = null;
let publisherConnectPromise: Promise<RedisClient> | null = null;
let subscriberReadyPromise: Promise<RedisClient> | null = null;
let subscriberSubscribed = false;
let subscriberWasReady = false;

// Pub/sub is at-most-once: every message published while the subscriber was
// disconnected is gone. The client re-subscribes the channel on its own, so
// the second and later `ready` events mark exactly those gaps.
function notifySubscriberReconnected(): void {
  if (!subscriberWasReady) {
    subscriberWasReady = true;
    return;
  }
  for (const listener of reconnectListeners) {
    try {
      listener();
    } catch (error) {
      console.error("Redis subscriber reconnect listener error:", error);
    }
  }
}

function getPublisher(): RedisClient {
  if (publisher) {
    return publisher;
  }

  const nextPublisher = createRedisClient();
  nextPublisher.on("error", (err) => {
    console.error("Redis publisher error:", err);
  });
  publisher = nextPublisher;
  return nextPublisher;
}

function getSubscriber(): RedisClient {
  if (subscriber) {
    return subscriber;
  }

  const nextSubscriber = createRedisClient();
  nextSubscriber.on("error", (err) => {
    console.error("Redis subscriber error:", err);
  });
  nextSubscriber.on("ready", notifySubscriberReconnected);
  subscriber = nextSubscriber;
  return nextSubscriber;
}

async function ensurePublisher(): Promise<RedisClient> {
  const activePublisher = getPublisher();
  if (activePublisher.isOpen) {
    return activePublisher;
  }
  if (publisherConnectPromise) {
    return publisherConnectPromise;
  }

  publisherConnectPromise = activePublisher
    .connect()
    .then(() => activePublisher)
    .catch((error) => {
      publisherConnectPromise = null;
      throw error;
    });

  const connectedPublisher = await publisherConnectPromise;
  publisherConnectPromise = null;
  return connectedPublisher;
}

async function ensureSubscriber(): Promise<RedisClient> {
  const activeSubscriber = getSubscriber();
  if (subscriberReadyPromise) {
    return subscriberReadyPromise;
  }
  if (activeSubscriber.isOpen && subscriberSubscribed) {
    return activeSubscriber;
  }

  subscriberReadyPromise = (async () => {
    if (!activeSubscriber.isOpen) {
      await activeSubscriber.connect();
    }
    if (!subscriberSubscribed) {
      await activeSubscriber.subscribe(CHANNEL, (message) => {
        for (const listener of listeners) {
          listener(message);
        }
      });
      subscriberSubscribed = true;
    }
    return activeSubscriber;
  })().catch((error) => {
    subscriberReadyPromise = null;
    throw error;
  });

  const readySubscriber = await subscriberReadyPromise;
  subscriberReadyPromise = null;
  return readySubscriber;
}

export async function publish(event: PublishedRealtimeEvent): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    await inMemoryRedisPublish(event);
    return;
  }

  const activePublisher = await ensurePublisher();
  await activePublisher.publish(CHANNEL, JSON.stringify(event));
}

export function addListener(listener: EventListener): () => void {
  if (isInMemoryRedisEnabled()) {
    return inMemoryRedisAddListener(listener);
  }

  listeners.add(listener);
  void ensureSubscriber().catch((error) => {
    console.error("Redis subscriber setup error:", error);
  });
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Observe the subscriber re-establishing its connection after a drop. The
 * in-memory bus never disconnects, so it never fires.
 */
export function addSubscriberReconnectListener(
  listener: () => void,
): () => void {
  if (isInMemoryRedisEnabled()) {
    return () => {};
  }

  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

export async function closeRedisPubSub(): Promise<void> {
  if (isInMemoryRedisEnabled()) {
    clearInMemoryRedisPubSub();
    return;
  }

  const activePublisher = publisher;
  const activeSubscriber = subscriber;

  publisher = null;
  subscriber = null;
  publisherConnectPromise = null;
  subscriberReadyPromise = null;
  subscriberSubscribed = false;
  subscriberWasReady = false;

  if (activeSubscriber?.isOpen) {
    await activeSubscriber.close();
  }

  if (activePublisher?.isOpen) {
    await activePublisher.close();
  }
}
