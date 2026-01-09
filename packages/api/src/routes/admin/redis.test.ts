import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';

const mockExec = vi.fn();
const mockMulti = vi.fn(() => ({
  type: vi.fn().mockReturnThis(),
  ttl: vi.fn().mockReturnThis(),
  exec: mockExec
}));

function createMockScanIterator(keys: string[]) {
  return async function* () {
    // scanIterator yields batches of keys
    if (keys.length > 0) {
      yield keys;
    }
  };
}

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn(() =>
    Promise.resolve({
      scanIterator: createMockScanIterator([]),
      multi: mockMulti
    })
  )
}));

describe('Admin Redis Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /v1/admin/redis/keys', () => {
    it('returns empty array when no keys exist', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      vi.mocked(getRedisClient).mockResolvedValue({
        scanIterator: createMockScanIterator([]),
        multi: mockMulti
      } as never);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ keys: [] });
    });

    it('returns keys with type and ttl information', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockExec.mockResolvedValue(['hash', -1, 'string', 3600]);

      vi.mocked(getRedisClient).mockResolvedValue({
        scanIterator: createMockScanIterator(['user:1', 'session:abc']),
        multi: mockMulti
      } as never);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [
          { key: 'user:1', type: 'hash', ttl: -1 },
          { key: 'session:abc', type: 'string', ttl: 3600 }
        ]
      });
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

      mockExec.mockResolvedValue([undefined, undefined]);

      vi.mocked(getRedisClient).mockResolvedValue({
        scanIterator: createMockScanIterator(['orphan:key']),
        multi: mockMulti
      } as never);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [{ key: 'orphan:key', type: 'unknown', ttl: -1 }]
      });
    });
  });
});
