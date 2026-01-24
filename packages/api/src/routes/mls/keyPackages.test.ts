import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const sessionStore = new Map<string, string>();
const userSessionsStore = new Map<string, Set<string>>();
const mockTtl = new Map<string, number>();

const createMockClient = () => ({
  get: (key: string) => {
    if (key.startsWith('session:')) {
      return Promise.resolve(sessionStore.get(key) ?? null);
    }
    return Promise.resolve(null);
  },
  set: (key: string, value: string, options?: { EX?: number }) => {
    sessionStore.set(key, value);
    if (options?.EX) {
      mockTtl.set(key, options.EX);
    }
    return Promise.resolve('OK');
  },
  expire: (key: string, seconds: number) => {
    mockTtl.set(key, seconds);
    return Promise.resolve(1);
  },
  ttl: (key: string) => Promise.resolve(mockTtl.get(key) ?? -1),
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
  sMembers: (key: string) => {
    const set = userSessionsStore.get(key);
    return Promise.resolve(set ? Array.from(set) : []);
  }
});

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient()))
}));

const mockKeyPackages: Array<{
  id: string;
  userId: string;
  keyPackageData: string;
  consumed: boolean;
  createdAt: Date;
}> = [];

vi.mock('../../lib/db.js', () => ({
  getDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'kp-new' }]))
      }))
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mockKeyPackages))
      }))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ id: 'kp-1' }]))
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([]))
    }))
  }))
}));

describe('MLS Key Packages Routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    sessionStore.clear();
    userSessionsStore.clear();
    mockTtl.clear();
    mockKeyPackages.length = 0;
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/mls/key-packages', () => {
    it('uploads key packages successfully', async () => {
      const response = await request(app)
        .post('/v1/mls/key-packages')
        .set('Authorization', authHeader)
        .send({
          keyPackages: [
            { id: 'kp-1', data: 'package-data-1' },
            { id: 'kp-2', data: 'package-data-2' }
          ]
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('count', 2);
    });

    it('returns 400 for invalid payload', async () => {
      const response = await request(app)
        .post('/v1/mls/key-packages')
        .set('Authorization', authHeader)
        .send({ keyPackages: 'not-an-array' });

      expect(response.status).toBe(400);
    });

    it('returns 401 without auth header', async () => {
      const response = await request(app)
        .post('/v1/mls/key-packages')
        .send({ keyPackages: [] });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/mls/key-packages/count', () => {
    it('returns count of available key packages', async () => {
      mockKeyPackages.push(
        {
          id: 'kp-1',
          userId: 'user-1',
          keyPackageData: 'data',
          consumed: false,
          createdAt: new Date()
        },
        {
          id: 'kp-2',
          userId: 'user-1',
          keyPackageData: 'data',
          consumed: false,
          createdAt: new Date()
        }
      );

      const response = await request(app)
        .get('/v1/mls/key-packages/count')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
    });
  });

  describe('GET /v1/mls/key-packages/:userId', () => {
    it('fetches and consumes a key package', async () => {
      mockKeyPackages.push({
        id: 'kp-1',
        userId: 'user-2',
        keyPackageData: 'package-data-1',
        consumed: false,
        createdAt: new Date()
      });

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('keyPackage');
    });

    it('returns 404 when no key packages available', async () => {
      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });
  });
});
