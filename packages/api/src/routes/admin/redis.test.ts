import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import type { RedisClient } from '../../lib/redis.js';
import { mockConsoleError } from '../../test/console-mocks.js';

// Type guard for test mocks
function isRedisClient(obj: unknown): obj is RedisClient {
  return obj !== null && typeof obj === 'object';
}

const mockExec = vi.fn();
const mockMulti = vi.fn(() => ({
  type: vi.fn().mockReturnThis(),
  ttl: vi.fn().mockReturnThis(),
  exec: mockExec
}));

const mockScan = vi.fn();
const mockType = vi.fn();
const mockTtl = vi.fn();
const mockGet = vi.fn();
const mockSMembers = vi.fn();
const mockHGetAll = vi.fn();
const mockDel = vi.fn();
const mockDbSize = vi.fn();

function createMockClient(): RedisClient {
  const mock = {
    scan: mockScan,
    multi: mockMulti,
    type: mockType,
    ttl: mockTtl,
    get: mockGet,
    sMembers: mockSMembers,
    hGetAll: mockHGetAll,
    del: mockDel,
    dbSize: mockDbSize
  };
  if (!isRedisClient(mock)) throw new Error('Invalid mock');
  return mock;
}

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient()))
}));

describe('Admin Redis Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScan.mockResolvedValue({ cursor: 0, keys: [] });
  });

  describe('GET /v1/admin/redis/keys', () => {
    it('returns empty array when no keys exist', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

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

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

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

    it('skips undefined keys from scan results', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({
        cursor: 0,
        keys: ['user:1', undefined]
      });
      mockExec.mockResolvedValue(['hash', -1, 'string', 3600]);

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [{ key: 'user:1', type: 'hash', ttl: -1 }],
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

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

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

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      await request(app).get('/v1/admin/redis/keys?cursor=100&limit=25');

      expect(mockScan).toHaveBeenCalledWith('100', { MATCH: '*', COUNT: 25 });
    });

    it('caps limit at 100', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({ cursor: 0, keys: [] });

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      await request(app).get('/v1/admin/redis/keys?limit=500');

      expect(mockScan).toHaveBeenCalledWith('0', { MATCH: '*', COUNT: 100 });
    });

    it('handles Redis connection errors', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient).mockRejectedValue(
        new Error('Connection refused')
      );

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Redis error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient).mockRejectedValue('string error');

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect to Redis' });
      expect(consoleSpy).toHaveBeenCalledWith('Redis error:', 'string error');
      consoleSpy.mockRestore();
    });

    it('handles missing type and ttl in results', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockScan.mockResolvedValue({
        cursor: 0,
        keys: ['orphan:key']
      });
      mockExec.mockResolvedValue([undefined, undefined]);

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keys: [{ key: 'orphan:key', type: 'unknown', ttl: -1 }],
        cursor: '0',
        hasMore: false
      });
    });
  });

  describe('GET /v1/admin/redis/dbsize', () => {
    it('returns the total key count', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      mockDbSize.mockResolvedValue(42);
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/dbsize');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 42 });
    });

    it('returns 0 for empty database', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      mockDbSize.mockResolvedValue(0);
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/dbsize');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0 });
    });

    it('handles Redis connection errors', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient).mockRejectedValue(
        new Error('Connection refused')
      );

      const response = await request(app).get('/v1/admin/redis/dbsize');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Redis error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      mockDbSize.mockRejectedValue('string error');
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/dbsize');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect to Redis' });
      expect(consoleSpy).toHaveBeenCalledWith('Redis error:', 'string error');
      consoleSpy.mockRestore();
    });
  });

  describe('GET /v1/admin/redis/keys/:key', () => {
    beforeEach(() => {
      mockType.mockReset();
      mockTtl.mockReset();
      mockGet.mockReset();
      mockSMembers.mockReset();
      mockHGetAll.mockReset();
    });

    it('returns string value for string type key', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockType.mockResolvedValue('string');
      mockTtl.mockResolvedValue(-1);
      mockGet.mockResolvedValue('hello world');

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/keys/mykey');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'mykey',
        type: 'string',
        ttl: -1,
        value: 'hello world'
      });
    });

    it('returns set members for set type key', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockType.mockResolvedValue('set');
      mockTtl.mockResolvedValue(3600);
      mockSMembers.mockResolvedValue(['member1', 'member2', 'member3']);

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/keys/myset');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'myset',
        type: 'set',
        ttl: 3600,
        value: ['member1', 'member2', 'member3']
      });
    });

    it('returns hash fields for hash type key', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockType.mockResolvedValue('hash');
      mockTtl.mockResolvedValue(-1);
      mockHGetAll.mockResolvedValue({ field1: 'value1', field2: 'value2' });

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/keys/myhash');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'myhash',
        type: 'hash',
        ttl: -1,
        value: { field1: 'value1', field2: 'value2' }
      });
    });

    it('returns null value for unsupported types', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockType.mockResolvedValue('list');
      mockTtl.mockResolvedValue(-1);

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/keys/mylist');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'mylist',
        type: 'list',
        ttl: -1,
        value: null
      });
    });

    it('returns 404 when key does not exist', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockType.mockResolvedValue('none');

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get(
        '/v1/admin/redis/keys/nonexistent'
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Key not found' });
    });

    it('handles Redis connection errors', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient).mockRejectedValue(
        new Error('Connection refused')
      );

      const response = await request(app).get('/v1/admin/redis/keys/anykey');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Redis error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      mockType.mockRejectedValue('string error');
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get('/v1/admin/redis/keys/anykey');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect to Redis' });
      expect(consoleSpy).toHaveBeenCalledWith('Redis error:', 'string error');
      consoleSpy.mockRestore();
    });

    it('handles URL-encoded key names', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');

      mockType.mockResolvedValue('string');
      mockTtl.mockResolvedValue(-1);
      mockGet.mockResolvedValue('value');

      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).get(
        '/v1/admin/redis/keys/user%3A123'
      );

      expect(response.status).toBe(200);
      expect(mockType).toHaveBeenCalledWith('user:123');
    });
  });

  describe('DELETE /v1/admin/redis/keys/:key', () => {
    it('returns deleted true when key exists', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      mockDel.mockResolvedValue(1);
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).delete('/v1/admin/redis/keys/user:1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
      expect(mockDel).toHaveBeenCalledWith('user:1');
    });

    it('returns deleted false when key does not exist', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      mockDel.mockResolvedValue(0);
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).delete(
        '/v1/admin/redis/keys/nonexistent'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: false });
    });

    it('handles URL-encoded keys', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      mockDel.mockResolvedValue(1);
      vi.mocked(getRedisClient).mockResolvedValue(createMockClient());

      const response = await request(app).delete(
        '/v1/admin/redis/keys/user%3A123%3Asession'
      );

      expect(response.status).toBe(200);
      expect(mockDel).toHaveBeenCalledWith('user:123:session');
    });

    it('handles Redis connection errors', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient).mockRejectedValue(
        new Error('Connection refused')
      );

      const response = await request(app).delete('/v1/admin/redis/keys/test');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Redis error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions', async () => {
      const { getRedisClient } = await import('../../lib/redis.js');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient).mockRejectedValue('string error');

      const response = await request(app).delete('/v1/admin/redis/keys/test');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect to Redis' });
      expect(consoleSpy).toHaveBeenCalledWith('Redis error:', 'string error');
      consoleSpy.mockRestore();
    });
  });
});
