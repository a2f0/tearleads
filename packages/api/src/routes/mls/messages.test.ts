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
  },
  publish: vi.fn(() => Promise.resolve(1))
});

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient()))
}));

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: vi.fn()
}));

describe('MLS Messages Routes', () => {
  let authHeader: string;
  const now = new Date();

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    sessionStore.clear();
    userSessionsStore.clear();
    mockTtl.clear();
    authHeader = await createAuthHeader();

    // Default postgres mock - supports both pool.query and pool.connect() for transactions
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue({
        query: mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 }),
        release: mockClientRelease
      })
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/mls/groups/:groupId/messages', () => {
    it('posts a new encrypted message', async () => {
      // pool.query is used for membership check and getting email
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-1' }],
          rowCount: 1
        }) // SELECT member check
        .mockResolvedValueOnce({
          rows: [{ email: 'test@example.com' }],
          rowCount: 1
        }); // SELECT user email

      // Transaction uses client.query
      mockClientQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT message
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE group
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'encrypted-message-data',
          epoch: 1
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toHaveProperty('ciphertext');
    });

    it('returns 400 for missing ciphertext', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          epoch: 1
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for missing epoch', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'encrypted-data'
        });

      expect(response.status).toBe(400);
    });

    it('returns 403 for non-member', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // member not found

      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'encrypted-data',
          epoch: 1
        });

      expect(response.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .send({ ciphertext: 'data', epoch: 1 });

      expect(response.status).toBe(401);
    });

    it('returns 400 for non-object body', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send('not-an-object');

      expect(response.status).toBe(400);
    });

    it('returns 400 for empty ciphertext', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({ ciphertext: '   ', epoch: 1 });

      expect(response.status).toBe(400);
    });

    it('returns 400 for negative epoch', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({ ciphertext: 'data', epoch: -1 });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-integer epoch', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({ ciphertext: 'data', epoch: 1.5 });

      expect(response.status).toBe(400);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // Error happens during membership check (pool.query)
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({ ciphertext: 'data', epoch: 1 });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /v1/mls/groups/:groupId/messages', () => {
    it('returns paginated message history', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-1' }],
          rowCount: 1
        }) // SELECT member check
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-1',
              sender_id: 'user-1',
              ciphertext: 'encrypted-1',
              epoch: 1,
              created_at: now
            },
            {
              id: 'msg-2',
              sender_id: 'user-2',
              ciphertext: 'encrypted-2',
              epoch: 1,
              created_at: now
            }
          ],
          rowCount: 2
        }); // SELECT messages

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('messages');
      expect(Array.isArray(response.body.messages)).toBe(true);
    });

    it('supports cursor pagination', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-1' }],
          rowCount: 1
        }) // SELECT member check
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT messages (empty after cursor)

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages?cursor=msg-5&limit=10')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('messages');
    });

    it('returns 403 for non-member', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // member not found

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get(
        '/v1/mls/groups/group-1/messages'
      );

      expect(response.status).toBe(401);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
    });

    it('handles invalid cursor gracefully', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-1' }],
          rowCount: 1
        }) // member check
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // cursor not found
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // messages query

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages?cursor=invalid-cursor')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('messages');
    });

    it('handles valid cursor pagination', async () => {
      const cursorDate = new Date();
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-1' }],
          rowCount: 1
        }) // member check
        .mockResolvedValueOnce({
          rows: [{ created_at: cursorDate }],
          rowCount: 1
        }) // cursor found
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-2',
              group_id: 'group-1',
              sender_id: 'user-1',
              sender_email: 'test@example.com',
              ciphertext: 'encrypted-2',
              epoch: 1,
              created_at: new Date()
            }
          ],
          rowCount: 1
        }); // messages after cursor

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages?cursor=msg-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('messages');
      expect(response.body.messages).toHaveLength(1);
    });

    it('respects limit parameter', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-1' }],
          rowCount: 1
        }) // member check
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // messages

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages?limit=10')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('handles hasMore pagination', async () => {
      const now = new Date();
      const messages = Array.from({ length: 51 }, (_, i) => ({
        id: `msg-${i}`,
        group_id: 'group-1',
        sender_id: 'user-1',
        sender_email: 'test@example.com',
        ciphertext: `encrypted-${i}`,
        epoch: 1,
        created_at: now
      }));

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-1' }],
          rowCount: 1
        }) // member check
        .mockResolvedValueOnce({ rows: messages, rowCount: 51 }); // messages

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('hasMore', true);
      expect(response.body).toHaveProperty('nextCursor');
    });
  });
});
