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
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: vi.fn()
}));

describe('MLS Groups Routes', () => {
  let authHeader: string;
  const now = new Date();

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    sessionStore.clear();
    userSessionsStore.clear();
    mockTtl.clear();
    authHeader = await createAuthHeader();

    // Default postgres mock - tests can override as needed
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/mls/groups', () => {
    it('creates a new group successfully', async () => {
      const groupRow = {
        id: 'group-new',
        name: 'Test Group',
        mls_group_id: 'mls-group-id-123',
        created_by: 'user-1',
        created_at: now,
        updated_at: now
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [groupRow], rowCount: 1 }) // INSERT group
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT member

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

    it('returns 400 for non-object body', async () => {
      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send('not-an-object');

      expect(response.status).toBe(400);
    });

    it('returns 400 for empty name', async () => {
      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({ name: '   ', mlsGroupId: 'mls-id' });

      expect(response.status).toBe(400);
    });

    it('returns 400 for empty mlsGroupId', async () => {
      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({ name: 'Group', mlsGroupId: '   ' });

      expect(response.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/mls/groups')
        .send({ name: 'Group', mlsGroupId: 'mls-id' });

      expect(response.status).toBe(401);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({ name: 'Group', mlsGroupId: 'mls-id' });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /v1/mls/groups', () => {
    it('returns list of user groups', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'group-1',
            name: 'Work Chat',
            mls_group_id: 'mls-1',
            created_by: 'user-1',
            created_at: now,
            updated_at: now,
            member_count: '1'
          }
        ],
        rowCount: 1
      });

      const response = await request(app)
        .get('/v1/mls/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('groups');
      expect(Array.isArray(response.body.groups)).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get('/v1/mls/groups');

      expect(response.status).toBe(401);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/mls/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
    });
  });

  describe('GET /v1/mls/groups/:id', () => {
    it('returns group details', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ exists: 1 }],
          rowCount: 1
        }) // 1. Membership check
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'group-1',
              name: 'Work Chat',
              mls_group_id: 'mls-1',
              created_by: 'user-1',
              created_at: now,
              updated_at: now
            }
          ],
          rowCount: 1
        }) // 2. SELECT group
        .mockResolvedValueOnce({
          rows: [
            {
              user_id: 'user-1',
              email: 'test@example.com',
              role: 'admin',
              joined_at: now
            }
          ],
          rowCount: 1
        }); // 3. SELECT members

      const response = await request(app)
        .get('/v1/mls/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('group');
      expect(response.body).toHaveProperty('members');
    });

    it('returns 403 when not a member of the group', async () => {
      // When group doesn't exist or user isn't a member, membership check fails first
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // membership check

      const response = await request(app)
        .get('/v1/mls/groups/non-existent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get('/v1/mls/groups/group-1');

      expect(response.status).toBe(401);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/mls/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
    });

    it('returns 404 when group not found after membership check passes', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ exists: 1 }],
          rowCount: 1
        }) // membership check passes
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // group not found

      const response = await request(app)
        .get('/v1/mls/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /v1/mls/groups/:id/members', () => {
    it('adds members to a group', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'admin' }],
          rowCount: 1
        }) // 1. Admin check
        .mockResolvedValueOnce({
          rows: [{ name: 'Test Group' }],
          rowCount: 1
        }) // 2. Get group name
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 3. Check existing member (not found)
        .mockResolvedValueOnce({
          rows: [{ email: 'user2@example.com' }],
          rowCount: 1
        }) // 4. Get user email
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // 5. INSERT member
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // 6. INSERT welcome
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // 7. UPDATE group

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

    it('returns 400 for empty memberUserIds', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: [],
          commitData: 'commit-data',
          welcomeMessages: []
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-string memberUserIds', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: [123],
          commitData: 'commit-data',
          welcomeMessages: []
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid welcomeMessages', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: 'commit-data',
          welcomeMessages: 'not-array'
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-object body', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send('not-an-object');

      expect(response.status).toBe(400);
    });

    it('returns 400 for empty commitData', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: '   ',
          welcomeMessages: [{ userId: 'user-2', welcomeData: 'data' }]
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-object welcomeMessage items', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: 'data',
          welcomeMessages: ['not-object']
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid welcomeMessage userId/welcomeData', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: 'data',
          welcomeMessages: [{ userId: 123, welcomeData: 456 }]
        });

      expect(response.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .send({
          memberUserIds: ['user-2'],
          commitData: 'data',
          welcomeMessages: []
        });

      expect(response.status).toBe(401);
    });

    it('returns 403 when not admin', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // admin check fails

      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: 'commit-data',
          welcomeMessages: [{ userId: 'user-2', welcomeData: 'welcome' }]
        });

      expect(response.status).toBe(403);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: 'data',
          welcomeMessages: [{ userId: 'user-2', welcomeData: 'welcome' }]
        });

      expect(response.status).toBe(500);
    });

    it('skips already existing members', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'admin' }],
          rowCount: 1
        }) // admin check
        .mockResolvedValueOnce({
          rows: [{ name: 'Test Group' }],
          rowCount: 1
        }) // get group name
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-2' }],
          rowCount: 1
        }) // member already exists
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // update group

      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          memberUserIds: ['user-2'],
          commitData: 'commit-data',
          welcomeMessages: [{ userId: 'user-2', welcomeData: 'welcome' }]
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('addedMembers');
      expect(response.body.addedMembers).toEqual([]);
    });
  });

  describe('DELETE /v1/mls/groups/:id/members/:userId', () => {
    it('removes a member from a group', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'admin' }],
          rowCount: 1
        }) // SELECT admin check
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE member
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE group updated_at

      const response = await request(app)
        .delete('/v1/mls/groups/group-1/members/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).delete(
        '/v1/mls/groups/group-1/members/user-2'
      );

      expect(response.status).toBe(401);
    });

    it('returns 403 when not admin', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // admin check fails

      const response = await request(app)
        .delete('/v1/mls/groups/group-1/members/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
    });

    it('returns 403 when non-admin tries to remove other member', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ role: 'member' }],
        rowCount: 1
      }); // user is member but not admin

      const response = await request(app)
        .delete('/v1/mls/groups/group-1/members/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty(
        'error',
        'Only admins can remove other members'
      );
    });

    it('returns 404 when member not found', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'admin' }],
          rowCount: 1
        }) // admin check
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // delete returns 0

      const response = await request(app)
        .delete('/v1/mls/groups/group-1/members/user-not-exist')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .delete('/v1/mls/groups/group-1/members/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
    });
  });
});
