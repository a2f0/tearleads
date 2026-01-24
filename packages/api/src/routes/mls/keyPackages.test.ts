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

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: vi.fn()
}));

describe('MLS Key Packages Routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    sessionStore.clear();
    userSessionsStore.clear();
    mockTtl.clear();
    authHeader = await createAuthHeader();

    // Default postgres mock
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/mls/key-packages', () => {
    it('uploads key packages successfully', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT first
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT second

      const response = await request(app)
        .post('/v1/mls/key-packages')
        .set('Authorization', authHeader)
        .send({
          keyPackages: [
            { keyPackageData: 'package-data-1' },
            { keyPackageData: 'package-data-2' }
          ]
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('uploaded', 2);
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
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1
      });

      const response = await request(app)
        .get('/v1/mls/key-packages/count')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
    });
  });

  describe('GET /v1/mls/key-packages/:userId', () => {
    it('fetches and consumes a key package', async () => {
      // The route uses UPDATE...RETURNING in a single query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'kp-1',
            key_package_data: 'package-data-1'
          }
        ],
        rowCount: 1
      });

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'kp-1');
      expect(response.body).toHaveProperty('keyPackageData', 'package-data-1');
    });

    it('returns 404 when no key packages available', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });
  });
});
