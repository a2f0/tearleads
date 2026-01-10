import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';

const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockDuplicate = vi.fn();

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
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: connected')) {
              res.destroy();
            }
          });
          res.on('end', () => callback(null, data));
          res.on('close', () => callback(null, data));
        });

      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
    });

    it('sends connected event with default channel', async () => {
      const response = await request(app)
        .get('/v1/sse')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: connected')) {
              res.destroy();
            }
          });
          res.on('end', () => callback(null, data));
          res.on('close', () => callback(null, data));
        });

      expect(response.body).toContain('event: connected');
      expect(response.body).toContain('"channels":["broadcast"]');
    });

    it('subscribes to custom channels', async () => {
      const response = await request(app)
        .get('/v1/sse?channels=channel1,channel2')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: connected')) {
              res.destroy();
            }
          });
          res.on('end', () => callback(null, data));
          res.on('close', () => callback(null, data));
        });

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

    it('creates a duplicate client for each connection', async () => {
      await request(app)
        .get('/v1/sse')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: connected')) {
              res.destroy();
            }
          });
          res.on('end', () => callback(null, data));
          res.on('close', () => callback(null, data));
        });

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
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: error')) {
              res.destroy();
            }
          });
          res.on('end', () => callback(null, data));
          res.on('close', () => callback(null, data));
        });

      expect(response.body).toContain('event: error');
      expect(response.body).toContain('Failed to establish SSE connection');
      consoleSpy.mockRestore();
    });

    it('trims and filters empty channel names', async () => {
      const response = await request(app)
        .get('/v1/sse?channels=channel1, , channel2 ,')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: connected')) {
              res.destroy();
            }
          });
          res.on('end', () => callback(null, data));
          res.on('close', () => callback(null, data));
        });

      expect(response.body).toContain('"channels":["channel1","channel2"]');
      expect(mockSubscribe).toHaveBeenCalledTimes(2);
    });
  });
});
