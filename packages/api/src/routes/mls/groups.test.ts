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

interface MockGroup {
  id: string;
  name: string;
  mlsGroupId: string;
  createdBy: string;
  createdAt: Date;
}

interface MockMember {
  id: string;
  groupId: string;
  userId: string;
  role: string;
  joinedAt: Date;
}

const mockGroups: MockGroup[] = [];
const mockMembers: MockMember[] = [];

vi.mock('../../lib/db.js', () => ({
  getDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() =>
          Promise.resolve([
            {
              id: 'group-new',
              name: 'Test Group',
              mlsGroupId: 'mls-id',
              createdBy: 'user-1',
              createdAt: new Date()
            }
          ])
        )
      }))
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mockGroups)),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockGroups))
        })),
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => Promise.resolve(mockGroups))
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
    })),
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(() =>
              Promise.resolve([
                {
                  id: 'group-new',
                  name: 'Test Group',
                  mlsGroupId: 'mls-id',
                  createdBy: 'user-1',
                  createdAt: new Date()
                }
              ])
            )
          }))
        }))
      })
    )
  }))
}));

describe('MLS Groups Routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    sessionStore.clear();
    userSessionsStore.clear();
    mockTtl.clear();
    mockGroups.length = 0;
    mockMembers.length = 0;
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/mls/groups', () => {
    it('creates a new group successfully', async () => {
      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({
          name: 'Test Group',
          mlsGroupId: 'mls-group-id-123'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('group');
      expect(response.body.group).toHaveProperty('name', 'Test Group');
    });

    it('returns 400 for missing name', async () => {
      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({
          mlsGroupId: 'mls-group-id-123'
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for missing mlsGroupId', async () => {
      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({
          name: 'Test Group'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /v1/mls/groups', () => {
    it('returns list of user groups', async () => {
      mockGroups.push({
        id: 'group-1',
        name: 'Work Chat',
        mlsGroupId: 'mls-1',
        createdBy: 'user-1',
        createdAt: new Date()
      });

      const response = await request(app)
        .get('/v1/mls/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('groups');
      expect(Array.isArray(response.body.groups)).toBe(true);
    });
  });

  describe('GET /v1/mls/groups/:id', () => {
    it('returns group details', async () => {
      mockGroups.push({
        id: 'group-1',
        name: 'Work Chat',
        mlsGroupId: 'mls-1',
        createdBy: 'user-1',
        createdAt: new Date()
      });

      mockMembers.push({
        id: 'member-1',
        groupId: 'group-1',
        userId: 'user-1',
        role: 'admin',
        joinedAt: new Date()
      });

      const response = await request(app)
        .get('/v1/mls/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('group');
      expect(response.body).toHaveProperty('members');
    });

    it('returns 404 for non-existent group', async () => {
      const response = await request(app)
        .get('/v1/mls/groups/non-existent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /v1/mls/groups/:id/members', () => {
    it('adds members to a group', async () => {
      mockGroups.push({
        id: 'group-1',
        name: 'Work Chat',
        mlsGroupId: 'mls-1',
        createdBy: 'user-1',
        createdAt: new Date()
      });

      mockMembers.push({
        id: 'member-1',
        groupId: 'group-1',
        userId: 'user-1',
        role: 'admin',
        joinedAt: new Date()
      });

      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: 'commit-data-base64',
          welcomeMessages: [{ userId: 'user-2', welcomeData: 'welcome-base64' }]
        });

      expect(response.status).toBe(200);
    });

    it('returns 400 for missing memberUserIds', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          commitData: 'commit-data'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /v1/mls/groups/:id/members/:userId', () => {
    it('removes a member from a group', async () => {
      mockGroups.push({
        id: 'group-1',
        name: 'Work Chat',
        mlsGroupId: 'mls-1',
        createdBy: 'user-1',
        createdAt: new Date()
      });

      mockMembers.push({
        id: 'member-1',
        groupId: 'group-1',
        userId: 'user-1',
        role: 'admin',
        joinedAt: new Date()
      });

      const response = await request(app)
        .delete('/v1/mls/groups/group-1/members/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });
  });
});
