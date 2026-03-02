import {
  Code,
  createContextValues,
  createHandlerContext
} from '@connectrpc/connect';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v1/notifications_connect';
import { SubscribeRequest } from '@tearleads/shared/gen/tearleads/v1/notifications_pb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_AUTH_CONTEXT_KEY } from '../context.js';
import { notificationConnectService } from './notificationService.js';

type MessageHandler = (message: string, channel: string) => void;

interface SubscriberClientMock {
  connect: () => Promise<void>;
  subscribe: (channel: string, handler: MessageHandler) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  quit: () => Promise<string>;
}

const subscribedHandlers = new Map<string, MessageHandler>();
const mockConnect = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockQuit = vi.fn();
const mockDuplicate = vi.fn();
const mockQuery = vi.fn();

vi.mock('../../lib/redisPubSub.js', () => ({
  getRedisSubscriberClient: vi.fn(() =>
    Promise.resolve({
      duplicate: mockDuplicate
    })
  )
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: vi.fn(() =>
    Promise.resolve({
      query: mockQuery
    })
  ),
  getPool: vi.fn(() =>
    Promise.resolve({
      query: mockQuery
    })
  )
}));

function createAuthContext(userId = 'user-1') {
  const contextValues = createContextValues();
  contextValues.set(CONNECT_AUTH_CONTEXT_KEY, {
    claims: {
      sub: userId,
      email: `${userId}@example.com`,
      jti: 'session-1'
    },
    session: {
      userId,
      email: `${userId}@example.com`,
      admin: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      lastActiveAt: '2026-03-02T00:00:00.000Z',
      ipAddress: '127.0.0.1'
    }
  });

  return createHandlerContext({
    service: NotificationService,
    method: NotificationService.methods.subscribe,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: 'http://localhost/v1/connect/tearleads.v1.NotificationService/Subscribe',
    contextValues
  });
}

function createContextWithoutAuth() {
  return createHandlerContext({
    service: NotificationService,
    method: NotificationService.methods.subscribe,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: 'http://localhost/v1/connect/tearleads.v1.NotificationService/Subscribe'
  });
}

describe('notificationConnectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribedHandlers.clear();
    mockConnect.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(
      async (channel: string, handler: MessageHandler) => {
        subscribedHandlers.set(channel, handler);
      }
    );
    mockUnsubscribe.mockResolvedValue(undefined);
    mockQuit.mockResolvedValue('OK');
    mockDuplicate.mockImplementation((): SubscriberClientMock => {
      return {
        connect: mockConnect,
        subscribe: mockSubscribe,
        unsubscribe: mockUnsubscribe,
        quit: mockQuit
      };
    });
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unauthenticated when auth context is missing', async () => {
    const context = createContextWithoutAuth();
    const stream = notificationConnectService.subscribe(
      new SubscribeRequest(),
      context
    );
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('streams connected + message events for authorized channels', async () => {
    const context = createAuthContext('user-1');
    const stream = notificationConnectService.subscribe(
      new SubscribeRequest({
        channels: ['broadcast']
      }),
      context
    );
    const iterator = stream[Symbol.asyncIterator]();

    const connectedResult = await iterator.next();
    expect(connectedResult.done).toBe(false);
    if (connectedResult.done) {
      throw new Error('Expected connected event');
    }
    expect(JSON.parse(connectedResult.value.json)).toEqual({
      event: 'connected',
      channels: ['broadcast']
    });

    const messageResultPromise = iterator.next();
    await vi.waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith(
        'broadcast',
        expect.any(Function)
      );
    });
    const handler = subscribedHandlers.get('broadcast');
    if (!handler) {
      throw new Error('Expected broadcast subscription handler');
    }

    handler(
      JSON.stringify({
        type: 'mls_message',
        payload: { id: 'msg-1' },
        timestamp: '2026-03-02T10:00:00.000Z'
      }),
      'broadcast'
    );

    const messageResult = await messageResultPromise;
    expect(messageResult.done).toBe(false);
    if (messageResult.done) {
      throw new Error('Expected message event');
    }
    expect(JSON.parse(messageResult.value.json)).toEqual({
      event: 'message',
      channel: 'broadcast',
      message: {
        type: 'mls_message',
        payload: { id: 'msg-1' },
        timestamp: '2026-03-02T10:00:00.000Z'
      }
    });

    context.abort();
    const endResult = await iterator.next();
    expect(endResult.done).toBe(true);
    expect(mockUnsubscribe).toHaveBeenCalledWith('broadcast');
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it('returns permission denied when all requested channels are unauthorized', async () => {
    const context = createAuthContext('user-1');
    const stream = notificationConnectService.subscribe(
      new SubscribeRequest({
        channels: ['mls:user:other-user']
      }),
      context
    );
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('skips invalid pubsub payloads that cannot be parsed', async () => {
    const context = createAuthContext('user-1');
    const stream = notificationConnectService.subscribe(
      new SubscribeRequest({
        channels: ['broadcast']
      }),
      context
    );
    const iterator = stream[Symbol.asyncIterator]();

    await iterator.next();

    const nextEventPromise = iterator.next();
    await vi.waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith(
        'broadcast',
        expect.any(Function)
      );
    });
    const handler = subscribedHandlers.get('broadcast');
    if (!handler) {
      throw new Error('Expected broadcast subscription handler');
    }

    handler('not-json', 'broadcast');
    context.abort();

    const result = await nextEventPromise;
    expect(result.done).toBe(true);
  });

  it('emits keepalive events for active subscriptions', async () => {
    vi.useFakeTimers();
    try {
      const context = createAuthContext('user-1');
      const stream = notificationConnectService.subscribe(
        new SubscribeRequest({
          channels: ['broadcast']
        }),
        context
      );
      const iterator = stream[Symbol.asyncIterator]();

      await iterator.next();
      const keepaliveResultPromise = iterator.next();

      await vi.waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalledWith(
          'broadcast',
          expect.any(Function)
        );
      });

      await vi.advanceTimersByTimeAsync(30000);

      const keepaliveResult = await keepaliveResultPromise;
      expect(keepaliveResult.done).toBe(false);
      if (keepaliveResult.done) {
        throw new Error('Expected keepalive event');
      }
      expect(JSON.parse(keepaliveResult.value.json)).toEqual({
        event: 'keepalive'
      });

      context.abort();
      await iterator.next();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns unavailable when redis subscription setup fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConnect.mockRejectedValueOnce(new Error('redis unavailable'));

    try {
      const context = createAuthContext('user-1');
      const stream = notificationConnectService.subscribe(
        new SubscribeRequest({
          channels: ['broadcast']
        }),
        context
      );
      const iterator = stream[Symbol.asyncIterator]();

      const connected = await iterator.next();
      expect(connected.done).toBe(false);

      await expect(iterator.next()).rejects.toMatchObject({
        code: Code.Unavailable
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
