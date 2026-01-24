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

interface MockMessage {
  id: string;
  groupId: string;
  senderId: string;
  ciphertext: string;
  epoch: number;
  createdAt: Date;
}

interface MockMember {
  id: string;
  groupId: string;
  userId: string;
  role: string;
  joinedAt: Date;
}

const mockMessages: MockMessage[] = [];
const mockMembers: MockMember[] = [];

vi.mock('../../lib/db.js', () => ({
  getDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() =>
          Promise.resolve([
            {
              id: 'msg-new',
              groupId: 'group-1',
              senderId: 'user-1',
              ciphertext: 'encrypted-data',
              epoch: 1,
              createdAt: new Date()
            }
          ])
        )
      }))
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          if (mockMembers.length > 0) {
            return Promise.resolve(mockMembers);
          }
          return Promise.resolve(mockMessages);
        }),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(mockMessages))
            }))
          }))
        })),
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(mockMessages))
            }))
          }))
        }))
      }))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([]))
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([]))
    }))
  }))
}));

describe('MLS Messages Routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    sessionStore.clear();
    userSessionsStore.clear();
    mockTtl.clear();
    mockMessages.length = 0;
    mockMembers.length = 0;
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/mls/groups/:groupId/messages', () => {
    it('posts a new encrypted message', async () => {
      mockMembers.push({
        id: 'member-1',
        groupId: 'group-1',
        userId: 'user-1',
        role: 'member',
        joinedAt: new Date()
      });

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
      const response = await request(app)
        .post('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'encrypted-data',
          epoch: 1
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /v1/mls/groups/:groupId/messages', () => {
    it('returns paginated message history', async () => {
      mockMembers.push({
        id: 'member-1',
        groupId: 'group-1',
        userId: 'user-1',
        role: 'member',
        joinedAt: new Date()
      });

      mockMessages.push(
        {
          id: 'msg-1',
          groupId: 'group-1',
          senderId: 'user-1',
          ciphertext: 'encrypted-1',
          epoch: 1,
          createdAt: new Date()
        },
        {
          id: 'msg-2',
          groupId: 'group-1',
          senderId: 'user-2',
          ciphertext: 'encrypted-2',
          epoch: 1,
          createdAt: new Date()
        }
      );

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('messages');
      expect(Array.isArray(response.body.messages)).toBe(true);
    });

    it('supports cursor pagination', async () => {
      mockMembers.push({
        id: 'member-1',
        groupId: 'group-1',
        userId: 'user-1',
        role: 'member',
        joinedAt: new Date()
      });

      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages?cursor=msg-5&limit=10')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('messages');
    });

    it('returns 403 for non-member', async () => {
      const response = await request(app)
        .get('/v1/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
    });
  });
});
