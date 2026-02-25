import type { Response } from 'supertest';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { cleanupSseClient, closeAllSSEConnections } from './router.js';

const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockDuplicate = vi.fn();
const mockQuery = vi.fn();

type ParserCallback = (error: Error | null, body: unknown) => void;

interface DestroyableResponse extends Response {
  destroy(): void;
}

function isDestroyable(res: Response): res is DestroyableResponse {
  return 'destroy' in res && typeof res.destroy === 'function';
}

function createSseParser(onData: (data: string, res: Response) => void) {
  return (res: Response, callback: ParserCallback) => {
    let data = '';
    let doneCalled = false;
    const done = (error: Error | null) => {
      if (doneCalled) return;
      doneCalled = true;
      callback(error, data);
    };

    res.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      onData(data, res);
    });
    res.on('end', () => done(null));
    res.on('close', () => done(null));
  };
}

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

describe('SSE Routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockConnect.mockResolvedValue(undefined);
    mockQuit.mockResolvedValue(undefined);
    mockSubscribe.mockResolvedValue(undefined);
    mockUnsubscribe.mockResolvedValue(undefined);
    mockDuplicate.mockReturnValue({
      connect: mockConnect,
      quit: mockQuit,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe
    });
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /v1/sse', () => {
    it('rejects x-auth-token without bearer authorization', async () => {
      const token = authHeader.replace('Bearer ', '');
      const response = await request(app)
        .get('/v1/sse')
        .set('x-auth-token', token);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns SSE headers', async () => {
      const response = await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
    });

    it('sends connected event with default channel', async () => {
      const response = await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.body).toContain('event: connected');
      expect(response.body).toContain('"channels":["broadcast"]');
    });

    it('subscribes to authorized channels', async () => {
      // Mock group membership check - user-1 is member of group-1
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app)
        .get('/v1/sse?channels=mls:user:user-1,mls:group:group-1')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.body).toContain(
        '"channels":["mls:user:user-1","mls:group:group-1"]'
      );
      expect(mockSubscribe).toHaveBeenCalledWith(
        'mls:user:user-1',
        expect.any(Function)
      );
      expect(mockSubscribe).toHaveBeenCalledWith(
        'mls:group:group-1',
        expect.any(Function)
      );
    });

    it('filters out unauthorized channels', async () => {
      const response = await request(app)
        .get('/v1/sse?channels=mls:user:other-user,mls:user:user-1')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.body).toContain('"channels":["mls:user:user-1"]');
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(mockSubscribe).toHaveBeenCalledWith(
        'mls:user:user-1',
        expect.any(Function)
      );
    });

    it('returns error when no channels are authorized', async () => {
      const response = await request(app)
        .get('/v1/sse?channels=mls:user:other-user,unauthorized-channel')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: error')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.body).toContain('event: error');
      expect(response.body).toContain('No authorized channels');
    });

    it('sends keepalive events', async () => {
      const originalSetInterval = globalThis.setInterval;
      const intervalSpy = vi
        .spyOn(globalThis, 'setInterval')
        .mockImplementation((handler, timeout, ...args) => {
          if (typeof handler === 'function') {
            handler(...args);
          }
          return originalSetInterval(() => {}, timeout);
        });

      const response = await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes(': keepalive')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      intervalSpy.mockRestore();

      expect(response.body).toContain(': keepalive');
    });

    it('logs cleanup errors when unsubscribe fails', async () => {
      mockUnsubscribe.mockRejectedValueOnce(new Error('cleanup failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await request(app)
        .get('/v1/sse?channels=broadcast')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleSpy).toHaveBeenCalledWith(
        'SSE cleanup error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('cleans up subscriptions on close', async () => {
      // Mock group membership check - user-1 is member of group-1
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await request(app)
        .get('/v1/sse?channels=mls:user:user-1,mls:group:group-1')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockUnsubscribe).toHaveBeenCalledWith('mls:user:user-1');
      expect(mockUnsubscribe).toHaveBeenCalledWith('mls:group:group-1');
      expect(mockQuit).toHaveBeenCalled();
    });

    it('creates a duplicate client for each connection', async () => {
      await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(mockDuplicate).toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalled();
    });

    it('handles Redis connection errors gracefully', async () => {
      mockConnect.mockRejectedValue(new Error('Connection failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: error')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.body).toContain('event: error');
      expect(response.body).toContain('Failed to establish SSE connection');
      expect(consoleSpy).toHaveBeenCalledWith(
        'SSE connection error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('trims and filters empty channel names', async () => {
      const response = await request(app)
        .get('/v1/sse?channels=mls:user:user-1, , broadcast ,')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.body).toContain(
        '"channels":["mls:user:user-1","broadcast"]'
      );
      expect(mockSubscribe).toHaveBeenCalledTimes(2);
    });

    it('forwards valid JSON messages from Redis', async () => {
      const testMessage = {
        type: 'test',
        payload: { data: 'hello' },
        timestamp: '2026-01-10T00:00:00.000Z'
      };

      const response = await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              // Get the message handler and invoke it
              const messageHandler = mockSubscribe.mock.calls[0]?.[1];
              if (typeof messageHandler === 'function') {
                messageHandler(JSON.stringify(testMessage), 'broadcast');
              }
            }
            if (data.includes('event: message')) {
              if (isDestroyable(res)) res.destroy();
            }
          })
        );

      expect(response.body).toContain('event: message');
      expect(response.body).toContain('"channel":"broadcast"');
      expect(response.body).toContain('"type":"test"');
    });

    it('ignores invalid JSON messages from Redis', async () => {
      let messageHandlerInvoked = false;
      const response = await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected') && !messageHandlerInvoked) {
              messageHandlerInvoked = true;
              // Get the message handler and invoke it with invalid JSON
              const messageHandler = mockSubscribe.mock.calls[0]?.[1];
              if (typeof messageHandler === 'function') {
                messageHandler('not valid json', 'broadcast');
              }
              // Give a small delay then close
              setTimeout(() => {
                if (isDestroyable(res)) res.destroy();
              }, 50);
            }
          })
        );

      // Should have connected but no message event (invalid JSON ignored)
      expect(response.body).toContain('event: connected');
      expect(response.body).not.toContain('event: message');
    });

    it('ignores valid JSON that is not a broadcast message', async () => {
      let messageHandlerInvoked = false;
      const response = await request(app)
        .get('/v1/sse')
        .set('Authorization', authHeader)
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected') && !messageHandlerInvoked) {
              messageHandlerInvoked = true;
              const messageHandler = mockSubscribe.mock.calls[0]?.[1];
              if (typeof messageHandler === 'function') {
                messageHandler(JSON.stringify({ foo: 'bar' }), 'broadcast');
              }
              setTimeout(() => {
                if (isDestroyable(res)) res.destroy();
              }, 50);
            }
          })
        );

      expect(response.body).toContain('event: connected');
      expect(response.body).not.toContain('event: message');
    });
  });

  describe('closeAllSSEConnections', () => {
    it('is safe to call when no connections exist', () => {
      expect(() => closeAllSSEConnections()).not.toThrow();
    });
  });

  describe('cleanupSseClient', () => {
    it('resolves when client is null', async () => {
      await expect(
        cleanupSseClient(null, ['channel'])
      ).resolves.toBeUndefined();
    });

    it('unsubscribes and quits when client exists', async () => {
      const unsubscribe = vi.fn().mockResolvedValue(undefined);
      const quit = vi.fn().mockResolvedValue('OK');

      await cleanupSseClient(
        {
          unsubscribe,
          quit
        },
        ['channel1', 'channel2']
      );

      expect(unsubscribe).toHaveBeenCalledWith('channel1');
      expect(unsubscribe).toHaveBeenCalledWith('channel2');
      expect(quit).toHaveBeenCalled();
    });
  });
});
