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

describe('MLS Welcomes Routes', () => {
  let authHeader: string;
  const now = new Date();

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

  describe('GET /v1/mls/welcomes', () => {
    it('returns pending welcome messages', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'welcome-1',
            group_id: 'group-1',
            welcome_data: 'welcome-data-base64',
            fetched: false,
            created_at: now,
            group_name: 'Test Group'
          }
        ],
        rowCount: 1
      });

      const response = await request(app)
        .get('/v1/mls/welcomes')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('welcomes');
      expect(Array.isArray(response.body.welcomes)).toBe(true);
    });

    it('returns empty array when no welcomes', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .get('/v1/mls/welcomes')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.welcomes).toEqual([]);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get('/v1/mls/welcomes');

      expect(response.status).toBe(401);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/mls/welcomes')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
    });
  });

  describe('POST /v1/mls/welcomes/:welcomeId/ack', () => {
    it('acknowledges a welcome message', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const response = await request(app)
        .post('/v1/mls/welcomes/welcome-1/ack')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('acknowledged', true);
    });

    it('returns 404 for non-existent welcome', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const response = await request(app)
        .post('/v1/mls/welcomes/non-existent/ack')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).post(
        '/v1/mls/welcomes/welcome-1/ack'
      );

      expect(response.status).toBe(401);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/mls/welcomes/welcome-1/ack')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
    });
  });
});
