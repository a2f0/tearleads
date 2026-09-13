import type { PublishedRealtimeEvent } from "../realtime/publishedRealtimeEvents";
import {
  clearInMemoryRedisPubSub,
  inMemoryRedisAddListener,
  inMemoryRedisPublish,
  isInMemoryRedisEnabled,
} from "./inMemoryRedis";
import { createRedisClient } from "./redisClient";

const CHANNEL = "events";

type EventListener = (message: string) => void;

/** The slice of a Redis client pub/sub needs; fakeable in tests. */
export interface PubSubClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  close(): Promise<unknown>;
  on(event: "error" | "ready", listener: (...args: unknown[]) => void): unknown;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, listener: EventListener): Promise<unknown>;
}

export interface RedisPubSubDeps {
  readonly createClient: () => PubSubClient;
  readonly inMemory: () => boolean;
}

class RedisPubSub {
  private readonly listeners = new Set<EventListener>();
  private readonly reconnectListeners = new Set<() => void>();
  private publisher: PubSubClient | null = null;
  private subscriber: PubSubClient | null = null;
  private publisherConnectPromise: Promise<PubSubClient> | null = null;
  private subscriberReadyPromise: Promise<PubSubClient> | null = null;
  private subscriberSubscribed = false;
  private subscriberWasReady = false;

  constructor(private readonly deps: RedisPubSubDeps) {}

  async publish(event: PublishedRealtimeEvent): Promise<void> {
    if (this.deps.inMemory()) {
      await inMemoryRedisPublish(event);
      return;
    }

    const activePublisher = await this.ensurePublisher();
    await activePublisher.publish(CHANNEL, JSON.stringify(event));
  }

  addListener(listener: EventListener): () => void {
    if (this.deps.inMemory()) {
      return inMemoryRedisAddListener(listener);
    }

    this.listeners.add(listener);
    void this.ensureSubscriber().catch((error) => {
      console.error("Redis subscriber setup error:", error);
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Observe the subscriber holding a subscription after a gap: the first time
   * it subscribes (sockets may already be open) and every re-connect. The
   * in-memory bus never disconnects, so it never fires.
   */
  addSubscriberReconnectListener(listener: () => void): () => void {
    if (this.deps.inMemory()) {
      return () => {};
    }

    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.deps.inMemory()) {
      clearInMemoryRedisPubSub();
      return;
    }

    const activePublisher = this.publisher;
    const activeSubscriber = this.subscriber;

    this.publisher = null;
    this.subscriber = null;
    this.publisherConnectPromise = null;
    this.subscriberReadyPromise = null;
    this.subscriberSubscribed = false;
    this.subscriberWasReady = false;

    if (activeSubscriber?.isOpen) {
      await activeSubscriber.close();
    }

    if (activePublisher?.isOpen) {
      await activePublisher.close();
    }
  }

  private notifyReconnectListeners(): void {
    for (const listener of this.reconnectListeners) {
      try {
        listener();
      } catch (error) {
        console.error("Redis subscriber reconnect listener error:", error);
      }
    }
  }

  // Pub/sub is at-most-once: every message published while the subscriber was
  // disconnected is gone. The client re-subscribes the channel on its own, so
  // the second and later `ready` events mark exactly those gaps. The first
  // `ready` precedes the initial subscription and is announced by
  // `ensureSubscriber` once that subscription actually holds.
  private notifySubscriberReconnected(): void {
    if (!this.subscriberWasReady) {
      this.subscriberWasReady = true;
      return;
    }
    this.notifyReconnectListeners();
  }

  private getPublisher(): PubSubClient {
    if (this.publisher) {
      return this.publisher;
    }

    const nextPublisher = this.deps.createClient();
    nextPublisher.on("error", (err) => {
      console.error("Redis publisher error:", err);
    });
    this.publisher = nextPublisher;
    return nextPublisher;
  }

  private getSubscriber(): PubSubClient {
    if (this.subscriber) {
      return this.subscriber;
    }

    const nextSubscriber = this.deps.createClient();
    nextSubscriber.on("error", (err) => {
      console.error("Redis subscriber error:", err);
    });
    nextSubscriber.on("ready", () => this.notifySubscriberReconnected());
    this.subscriber = nextSubscriber;
    return nextSubscriber;
  }

  private async ensurePublisher(): Promise<PubSubClient> {
    const activePublisher = this.getPublisher();
    if (activePublisher.isOpen) {
      return activePublisher;
    }
    if (this.publisherConnectPromise) {
      return this.publisherConnectPromise;
    }

    this.publisherConnectPromise = activePublisher
      .connect()
      .then(() => activePublisher)
      .catch((error) => {
        this.publisherConnectPromise = null;
        throw error;
      });

    const connectedPublisher = await this.publisherConnectPromise;
    this.publisherConnectPromise = null;
    return connectedPublisher;
  }

  private async ensureSubscriber(): Promise<PubSubClient> {
    const activeSubscriber = this.getSubscriber();
    if (this.subscriberReadyPromise) {
      return this.subscriberReadyPromise;
    }
    if (activeSubscriber.isOpen && this.subscriberSubscribed) {
      return activeSubscriber;
    }

    this.subscriberReadyPromise = this.connectAndSubscribe(
      activeSubscriber,
    ).catch((error) => {
      this.subscriberReadyPromise = null;
      throw error;
    });

    const readySubscriber = await this.subscriberReadyPromise;
    this.subscriberReadyPromise = null;
    return readySubscriber;
  }

  private async connectAndSubscribe(
    activeSubscriber: PubSubClient,
  ): Promise<PubSubClient> {
    if (!activeSubscriber.isOpen) {
      await activeSubscriber.connect();
    }
    if (!this.subscriberSubscribed) {
      await activeSubscriber.subscribe(CHANNEL, (message) => {
        for (const listener of this.listeners) {
          listener(message);
        }
      });
      this.subscriberSubscribed = true;
      // Sockets opened before this first subscription held missed every hint
      // published meanwhile, exactly like a reconnect gap; let them catch up
      // the same way.
      this.notifyReconnectListeners();
    }
    return activeSubscriber;
  }
}

export function createRedisPubSub(deps: RedisPubSubDeps): RedisPubSub {
  return new RedisPubSub(deps);
}

const redisPubSub = createRedisPubSub({
  createClient: createRedisClient,
  inMemory: isInMemoryRedisEnabled,
});

export const publish = (event: PublishedRealtimeEvent): Promise<void> =>
  redisPubSub.publish(event);
export const addListener = (listener: EventListener): (() => void) =>
  redisPubSub.addListener(listener);
export const addSubscriberReconnectListener = (
  listener: () => void,
): (() => void) => redisPubSub.addSubscriberReconnectListener(listener);
export const closeRedisPubSub = (): Promise<void> => redisPubSub.close();
