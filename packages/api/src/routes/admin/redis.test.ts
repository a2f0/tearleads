import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';

const mockKeys = vi.fn();
const mockType = vi.fn();
const mockTtl = vi.fn();

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn(() =>
    Promise.resolve({
      keys: mockKeys,
      type: mockType,
      ttl: mockTtl
    })
  )
}));

describe('Admin Redis Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /v1/admin/redis/keys', () => {
    it('returns empty array when no keys exist', async () => {
      mockKeys.mockResolvedValue([]);

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ keys: [] });
    });

    it('returns keys with type and ttl information', async () => {
      mockKeys.mockResolvedValue(['user:1', 'session:abc']);
      mockType.mockImplementation((key: string) => {
        if (key === 'user:1') return Promise.resolve('hash');
        return Promise.resolve('string');
      });
      mockTtl.mockImplementation((key: string) => {
        if (key === 'user:1') return Promise.resolve(-1);
        return Promise.resolve(3600);
      });

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
      mockKeys.mockRejectedValue(new Error('Connection refused'));

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
    });
  });
});
