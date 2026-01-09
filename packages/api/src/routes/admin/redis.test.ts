import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';

const mockExec = vi.fn();
const mockMulti = vi.fn(() => ({
  type: vi.fn().mockReturnThis(),
  ttl: vi.fn().mockReturnThis(),
  exec: mockExec
}));

const mockScan = vi.fn();

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn(() =>
    Promise.resolve({
      scan: mockScan,
      multi: mockMulti
    })
  )
}));

describe('Admin Redis Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScan.mockResolvedValue({ cursor: 0, keys: [] });
  });

  describe('GET /v1/admin/redis/keys', () => {
    it('returns empty array when no keys exist', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      vi.mocked(getRedisClient).mockResolvedValue({
        scan: mockScan,
        multi: mockMulti
      } as never);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [],
        cursor: '0',
        hasMore: false
      });
    });

    it('returns keys with type and ttl information', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({
        cursor: 0,
        keys: ['user:1', 'session:abc']
      });
      mockExec.mockResolvedValue(['hash', -1, 'string', 3600]);

      vi.mocked(getRedisClient).mockResolvedValue({
        scan: mockScan,
        multi: mockMulti
      } as never);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [
          { key: 'user:1', type: 'hash', ttl: -1 },
          { key: 'session:abc', type: 'string', ttl: 3600 }
        ],
        cursor: '0',
        hasMore: false
      });
    });

    it('returns hasMore true when cursor is not 0', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({
        cursor: 123,
        keys: ['key:1']
      });
      mockExec.mockResolvedValue(['string', -1]);

      vi.mocked(getRedisClient).mockResolvedValue({
        scan: mockScan,
        multi: mockMulti
      } as never);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [{ key: 'key:1', type: 'string', ttl: -1 }],
        cursor: '123',
        hasMore: true
      });
    });

    it('accepts cursor and limit query parameters', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({ cursor: 0, keys: [] });

      vi.mocked(getRedisClient).mockResolvedValue({
        scan: mockScan,
        multi: mockMulti
      } as never);

      await request(app).get('/v1/admin/redis/keys?cursor=100&limit=25');

      expect(mockScan).toHaveBeenCalledWith('100', { MATCH: '*', COUNT: 25 });
    });

    it('caps limit at 100', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({ cursor: 0, keys: [] });

      vi.mocked(getRedisClient).mockResolvedValue({
        scan: mockScan,
        multi: mockMulti
      } as never);

      await request(app).get('/v1/admin/redis/keys?limit=500');

      expect(mockScan).toHaveBeenCalledWith('0', { MATCH: '*', COUNT: 100 });
    });

    it('handles Redis connection errors', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      vi.mocked(getRedisClient).mockRejectedValue(
        new Error('Connection refused')
      );

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
    });

    it('handles non-Error exceptions', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      vi.mocked(getRedisClient).mockRejectedValue('string error');

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect to Redis' });
    });

    it('handles missing type and ttl in results', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({
        cursor: 0,
        keys: ['orphan:key']
      });
      mockExec.mockResolvedValue([undefined, undefined]);

      vi.mocked(getRedisClient).mockResolvedValue({
        scan: mockScan,
        multi: mockMulti
      } as never);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [{ key: 'orphan:key', type: 'unknown', ttl: -1 }],
        cursor: '0',
        hasMore: false
      });
    });
  });
});
