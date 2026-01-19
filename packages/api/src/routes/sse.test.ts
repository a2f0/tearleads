import type { IncomingMessage } from 'node:http';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { cleanupSseClient, closeAllSSEConnections } from './sse.js';

const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockDuplicate = vi.fn();

type ParserCallback = (error: Error | null, data: string) => void;

function createSseParser(onData: (data: string, res: IncomingMessage) => void) {
  return (res: IncomingMessage, callback: ParserCallback) => {
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

vi.mock('../lib/redisPubSub.js', () => ({
  getRedisSubscriberClient: vi.fn(() =>
    Promise.resolve({
      duplicate: mockDuplicate
    })
  )
}));

describe('SSE Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  describe('GET /v1/sse', () => {
    it('returns SSE headers', async () => {
      const response = await request(app)
        .get('/v1/sse')
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              res.destroy();
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
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              res.destroy();
            }
          })
        );

      expect(response.body).toContain('event: connected');
      expect(response.body).toContain('"channels":["broadcast"]');
    });

    it('subscribes to custom channels', async () => {
      const response = await request(app)
        .get('/v1/sse?channels=channel1,channel2')
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              res.destroy();
            }
          })
        );

      expect(response.body).toContain('"channels":["channel1","channel2"]');
      expect(mockSubscribe).toHaveBeenCalledWith(
        'channel1',
        expect.any(Function)
      );
      expect(mockSubscribe).toHaveBeenCalledWith(
        'channel2',
        expect.any(Function)
      );
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
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes(': keepalive')) {
              res.destroy();
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
        .get('/v1/sse?channels=channel1')
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              res.destroy();
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
      await request(app)
        .get('/v1/sse?channels=channel1,channel2')
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              res.destroy();
            }
          })
        );

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockUnsubscribe).toHaveBeenCalledWith('channel1');
      expect(mockUnsubscribe).toHaveBeenCalledWith('channel2');
      expect(mockQuit).toHaveBeenCalled();
    });

    it('creates a duplicate client for each connection', async () => {
      await request(app)
        .get('/v1/sse')
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              res.destroy();
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
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: error')) {
              res.destroy();
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
        .get('/v1/sse?channels=channel1, , channel2 ,')
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected')) {
              res.destroy();
            }
          })
        );

      expect(response.body).toContain('"channels":["channel1","channel2"]');
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
              res.destroy();
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
              setTimeout(() => res.destroy(), 50);
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
        .buffer(true)
        .parse(
          createSseParser((data, res) => {
            if (data.includes('event: connected') && !messageHandlerInvoked) {
              messageHandlerInvoked = true;
              const messageHandler = mockSubscribe.mock.calls[0]?.[1];
              if (typeof messageHandler === 'function') {
                messageHandler(JSON.stringify({ foo: 'bar' }), 'broadcast');
              }
              setTimeout(() => res.destroy(), 50);
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
      const quit = vi.fn().mockResolvedValue(undefined);

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
