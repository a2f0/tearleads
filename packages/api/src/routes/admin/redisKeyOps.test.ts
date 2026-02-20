import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

interface MockRedisClient {
  type: (key: string) => Promise<string>;
  ttl: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    options?: { EX?: number }
  ) => Promise<string>;
  expire: (key: string, seconds: number) => Promise<number>;
  sAdd: (key: string, member: string) => Promise<number>;
  sRem: (key: string, member: string) => Promise<number>;
  sMembers: (key: string) => Promise<string[]>;
  hGetAll: (key: string) => Promise<Record<string, string>>;
  del: (key: string) => Promise<number>;
}

const sessionStore = new Map<string, string>();
const userSessionsStore = new Map<string, Set<string>>();
const sessionTtl = new Map<string, number>();

const mockType = vi.fn();
const mockTtl = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockExpire = vi.fn();
const mockSMembers = vi.fn();
const mockHGetAll = vi.fn();
const mockDel = vi.fn();

const createMockClient = (): MockRedisClient => ({
  type: mockType,
  ttl: (key: string) => {
    if (key.startsWith('session:') || key.startsWith('user_sessions:')) {
      return Promise.resolve(sessionTtl.get(key) ?? -1);
    }
    return mockTtl(key);
  },
  get: (key: string) => {
    if (key.startsWith('session:')) {
      return Promise.resolve(sessionStore.get(key) ?? null);
    }
    return mockGet(key);
  },
  set: (key: string, value: string, options?: { EX?: number }) => {
    sessionStore.set(key, value);
    mockSet(key, value);
    if (options?.EX) {
      sessionTtl.set(key, options.EX);
    }
    return Promise.resolve('OK');
  },
  expire: (key: string, seconds: number) => {
    mockExpire(key, seconds);
    sessionTtl.set(key, seconds);
    return Promise.resolve(1);
  },
  sAdd: (key: string, member: string) => {
    if (!userSessionsStore.has(key)) {
      userSessionsStore.set(key, new Set());
    }
    userSessionsStore.get(key)?.add(member);
    return Promise.resolve(1);
  },
  sRem: (key: string, member: string) => {
    const set = userSessionsStore.get(key);
    if (set?.delete(member)) {
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  },
  sMembers: mockSMembers,
  hGetAll: mockHGetAll,
  del: mockDel
});

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient()))
}));

const mockClientAsRedis = () =>
  createMockClient() as unknown as Awaited<
    ReturnType<typeof import('@tearleads/shared/redis').getRedisClient>
  >;

describe('Admin Redis Key Operations', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStore.clear();
    userSessionsStore.clear();
    sessionTtl.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader({
      id: 'admin-1',
      email: 'admin@example.com',
      admin: true
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      const { getRedisClient } = await import('@tearleads/shared/redis');

      mockType.mockResolvedValue('string');
      mockTtl.mockResolvedValue(-1);
      mockGet.mockResolvedValue('hello world');

      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .get('/v1/admin/redis/keys/mykey')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'mykey',
        type: 'string',
        ttl: -1,
        value: 'hello world'
      });
    });

    it('returns set members for set type key', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');

      mockType.mockResolvedValue('set');
      mockTtl.mockResolvedValue(3600);
      mockSMembers.mockResolvedValue(['member1', 'member2', 'member3']);

      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .get('/v1/admin/redis/keys/myset')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'myset',
        type: 'set',
        ttl: 3600,
        value: ['member1', 'member2', 'member3']
      });
    });

    it('returns hash fields for hash type key', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');

      mockType.mockResolvedValue('hash');
      mockTtl.mockResolvedValue(-1);
      mockHGetAll.mockResolvedValue({ field1: 'value1', field2: 'value2' });

      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .get('/v1/admin/redis/keys/myhash')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'myhash',
        type: 'hash',
        ttl: -1,
        value: { field1: 'value1', field2: 'value2' }
      });
    });

    it('returns null value for unsupported types', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');

      mockType.mockResolvedValue('list');
      mockTtl.mockResolvedValue(-1);

      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .get('/v1/admin/redis/keys/mylist')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        key: 'mylist',
        type: 'list',
        ttl: -1,
        value: null
      });
    });

    it('returns 404 when key does not exist', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');

      mockType.mockResolvedValue('none');

      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .get('/v1/admin/redis/keys/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Key not found' });
    });

    it('handles Redis connection errors', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient)
        .mockResolvedValueOnce(mockClientAsRedis()) // getSession
        .mockResolvedValueOnce(mockClientAsRedis()) // updateSessionActivity
        .mockRejectedValueOnce(new Error('Connection refused'));

      const response = await request(app)
        .get('/v1/admin/redis/keys/anykey')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Redis error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
      const consoleSpy = mockConsoleError();
      mockType.mockRejectedValue('string error');
      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .get('/v1/admin/redis/keys/anykey')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect to Redis' });
      expect(consoleSpy).toHaveBeenCalledWith('Redis error:', 'string error');
      consoleSpy.mockRestore();
    });

    it('handles URL-encoded key names', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');

      mockType.mockResolvedValue('string');
      mockTtl.mockResolvedValue(-1);
      mockGet.mockResolvedValue('value');

      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .get('/v1/admin/redis/keys/user%3A123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(mockType).toHaveBeenCalledWith('user:123');
    });
  });

  describe('DELETE /v1/admin/redis/keys/:key', () => {
    it('returns deleted true when key exists', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
      mockDel.mockResolvedValue(1);
      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .delete('/v1/admin/redis/keys/user:1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
      expect(mockDel).toHaveBeenCalledWith('user:1');
    });

    it('returns deleted false when key does not exist', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
      mockDel.mockResolvedValue(0);
      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .delete('/v1/admin/redis/keys/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: false });
    });

    it('handles URL-encoded keys', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
      mockDel.mockResolvedValue(1);
      vi.mocked(getRedisClient).mockResolvedValue(mockClientAsRedis());

      const response = await request(app)
        .delete('/v1/admin/redis/keys/user%3A123%3Asession')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(mockDel).toHaveBeenCalledWith('user:123:session');
    });

    it('handles Redis connection errors', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient)
        .mockResolvedValueOnce(mockClientAsRedis()) // getSession
        .mockResolvedValueOnce(mockClientAsRedis()) // updateSessionActivity
        .mockRejectedValueOnce(new Error('Connection refused'));

      const response = await request(app)
        .delete('/v1/admin/redis/keys/test')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Connection refused' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Redis error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
      const consoleSpy = mockConsoleError();
      vi.mocked(getRedisClient)
        .mockResolvedValueOnce(mockClientAsRedis()) // getSession
        .mockResolvedValueOnce(mockClientAsRedis()) // updateSessionActivity
        .mockRejectedValueOnce('string error');

      const response = await request(app)
        .delete('/v1/admin/redis/keys/test')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect to Redis' });
      expect(consoleSpy).toHaveBeenCalledWith('Redis error:', 'string error');
      consoleSpy.mockRestore();
    });
  });
});
