import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockBroadcast = vi.fn((_c: string, _m: unknown) => Promise.resolve(1));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

vi.mock('../../lib/broadcast.js', () => ({
  broadcast: (c: string, m: unknown) => mockBroadcast(c, m)
}));

const sessionStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(sessionStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string) => {
    sessionStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    sessionStore.delete(key);
    return Promise.resolve(1);
  }),
  sAdd: vi.fn(() => Promise.resolve(1)),
  sRem: vi.fn(() => Promise.resolve(1)),
  expire: vi.fn(() => Promise.resolve(1))
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient),
  getRedisSubscriberOverride: () => mockRedisClient,
  setRedisSubscriberOverrideForTesting: vi.fn()
}));

describe('MLS VFS message routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /v1/vfs/mls/groups/:groupId/messages', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await request(app).get(
        '/v1/vfs/mls/groups/group-1/messages'
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 400 for non-positive limit values', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      const response = await request(app)
        .get('/v1/vfs/mls/groups/group-1/messages?limit=0')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'limit must be a positive integer'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid cursor values', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      const response = await request(app)
        .get('/v1/vfs/mls/groups/group-1/messages?cursor=not-a-number')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'cursor must be a positive integer'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 403 when user is not an active group member', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Not a member of this group' });
    });

    it('returns VFS-backed application messages for active members', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'member', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-1',
              group_id: 'group-1',
              sender_user_id: 'user-2',
              epoch: 3,
              ciphertext: 'ciphertext',
              message_type: 'application',
              content_type: 'text/plain',
              sequence_number: 10,
              created_at: new Date('2026-03-01T00:00:00.000Z'),
              sender_email: 'user-2@example.com'
            }
          ]
        });

      const response = await request(app)
        .get('/v1/vfs/mls/groups/group-1/messages?limit=50')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        messages: [
          {
            id: 'msg-1',
            groupId: 'group-1',
            senderUserId: 'user-2',
            senderEmail: 'user-2@example.com',
            epoch: 3,
            ciphertext: 'ciphertext',
            messageType: 'application',
            contentType: 'text/plain',
            sequenceNumber: 10,
            sentAt: '2026-03-01T00:00:00.000Z',
            createdAt: '2026-03-01T00:00:00.000Z'
          }
        ],
        hasMore: false
      });
    });

    it('returns cursor when additional pages are available', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'member', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-2',
              group_id: 'group-1',
              sender_user_id: 'user-2',
              epoch: 3,
              ciphertext: 'ciphertext-2',
              message_type: 'application',
              content_type: 'text/plain',
              sequence_number: 2,
              created_at: new Date('2026-03-01T00:00:01.000Z'),
              sender_email: null
            },
            {
              id: 'msg-1',
              group_id: 'group-1',
              sender_user_id: 'user-2',
              epoch: 3,
              ciphertext: 'ciphertext-1',
              message_type: 'application',
              content_type: 'text/plain',
              sequence_number: 1,
              created_at: new Date('2026-03-01T00:00:00.000Z'),
              sender_email: null
            }
          ]
        });

      const response = await request(app)
        .get('/v1/vfs/mls/groups/group-1/messages?limit=1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        messages: [
          {
            id: 'msg-2',
            groupId: 'group-1',
            senderUserId: 'user-2',
            epoch: 3,
            ciphertext: 'ciphertext-2',
            messageType: 'application',
            contentType: 'text/plain',
            sequenceNumber: 2,
            sentAt: '2026-03-01T00:00:01.000Z',
            createdAt: '2026-03-01T00:00:01.000Z'
          }
        ],
        hasMore: true,
        cursor: '2'
      });
    });

    it('returns 500 when message query fails', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      const restoreConsoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'member', organization_id: 'org-1' }]
        })
        .mockRejectedValueOnce(new Error('query failed'));

      const response = await request(app)
        .get('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get messages' });
      restoreConsoleError.mockRestore();
    });
  });

  describe('POST /v1/vfs/mls/groups/:groupId/messages', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await request(app).post(
        '/v1/vfs/mls/groups/group-1/messages'
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 403 when user is not an active group member', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'ciphertext',
          epoch: 2,
          messageType: 'application'
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Not a member of this group' });
    });

    it('mirrors application messages into VFS tables and CRDT feed', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'member', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
        .mockResolvedValueOnce({ rows: [{ max_sequence: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'ciphertext',
          epoch: 2,
          messageType: 'application',
          contentType: 'text/plain'
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        message: {
          id: expect.any(String),
          groupId: 'group-1',
          senderUserId: 'user-1',
          epoch: 2,
          ciphertext: 'ciphertext',
          messageType: 'application',
          contentType: 'text/plain',
          sequenceNumber: 1,
          sentAt: expect.any(String),
          createdAt: expect.any(String)
        }
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        6,
        expect.stringContaining('INSERT INTO mls_messages'),
        expect.arrayContaining(['group-1', 'ciphertext', 'text/plain'])
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        7,
        expect.stringContaining('INSERT INTO vfs_registry'),
        expect.any(Array)
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        8,
        expect.stringContaining('INSERT INTO vfs_item_state'),
        expect.arrayContaining(['ciphertext', 2])
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        9,
        expect.stringContaining('INSERT INTO vfs_acl_entries'),
        expect.arrayContaining(['group-1'])
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        10,
        expect.stringContaining('INSERT INTO vfs_crdt_ops'),
        expect.arrayContaining(['user-1', 'ciphertext', 2])
      );
    });

    it('rejects send-message payloads with stale epochs', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'member', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ current_epoch: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'ciphertext',
          epoch: 2,
          messageType: 'application'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Epoch mismatch' });
      expect(mockQuery).toHaveBeenCalledTimes(5);
    });

    it('returns 404 when target group no longer exists', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'member', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'ciphertext',
          epoch: 2,
          messageType: 'application'
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Group not found' });
    });

    it('rejects non-integer epochs in send-message payloads', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      const response = await request(app)
        .post('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'ciphertext',
          epoch: 1.5,
          messageType: 'application'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid message payload' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects non-application message types', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      const response = await request(app)
        .post('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'ciphertext',
          epoch: 2,
          messageType: 'commit'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Only application messages are supported'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 500 when transaction writes fail', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      const restoreConsoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'member', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
        .mockRejectedValueOnce(new Error('count failed'))
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/mls/groups/group-1/messages')
        .set('Authorization', authHeader)
        .send({
          ciphertext: 'ciphertext',
          epoch: 2,
          messageType: 'application'
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to send message' });
      restoreConsoleError.mockRestore();
    });
  });
});
