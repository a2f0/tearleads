import { MLS_CIPHERSUITES } from '@tearleads/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

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

describe('MLS routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /v1/mls/key-packages/:userId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/mls/key-packages/user-2');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when target user is outside caller org scope', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INNER JOIN user_organizations target_uo'),
        ['user-1', 'user-2']
      );
    });

    it('returns key packages when target user shares an organization', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce({
        rows: [
          {
            id: 'kp-1',
            key_package_data: 'encoded-kp',
            key_package_ref: 'kp-ref',
            cipher_suite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519,
            created_at: new Date('2024-01-01T00:00:00.000Z')
          }
        ]
      });

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keyPackages: [
          {
            id: 'kp-1',
            userId: 'user-2',
            keyPackageData: 'encoded-kp',
            keyPackageRef: 'kp-ref',
            cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519,
            createdAt: '2024-01-01T00:00:00.000Z',
            consumed: false
          }
        ]
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('FROM mls_key_packages'),
        ['user-2']
      );
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get key packages' });
      restoreConsole();
    });
  });

  describe('POST /v1/mls/groups/:groupId/members', () => {
    it('returns 404 when target user is outside caller org scope', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'admin', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          userId: 'user-2',
          commit: 'commit-bytes',
          welcome: 'welcome-bytes',
          keyPackageRef: 'kp-ref',
          newEpoch: 2
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
    });

    it('returns 409 when key package is unavailable for the target user', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });
      const mockClientQuery = vi.fn();
      const mockRelease = vi.fn();
      const mockConnect = vi.fn().mockResolvedValue({
        query: mockClientQuery,
        release: mockRelease
      });

      mockGetPostgresPool.mockResolvedValueOnce({
        query: mockQuery,
        connect: mockConnect
      });
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ role: 'admin', organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({ rows: [{}] });
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ current_epoch: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({});

      const response = await request(app)
        .post('/v1/mls/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({
          userId: 'user-2',
          commit: 'commit-bytes',
          welcome: 'welcome-bytes',
          keyPackageRef: 'kp-ref',
          newEpoch: 2
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Key package not available' });
      expect(mockClientQuery).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('AND organization_id = $4'),
        ['group-1', 'kp-ref', 'user-2', 'org-1']
      );
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/mls/groups', () => {
    it('returns 403 when caller has no scoped organization', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({
          name: 'Group Name',
          groupIdMls: 'group-id-mls',
          cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'No organization found for user'
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT personal_organization_id'),
        ['user-1']
      );
    });

    it('creates groups with an organization scope', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });
      const mockClientQuery = vi.fn();
      const mockRelease = vi.fn();
      const mockConnect = vi.fn().mockResolvedValue({
        query: mockClientQuery,
        release: mockRelease
      });

      mockGetPostgresPool.mockResolvedValueOnce({
        query: mockQuery,
        connect: mockConnect
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ personal_organization_id: 'org-1' }]
      });
      mockClientQuery
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const response = await request(app)
        .post('/v1/mls/groups')
        .set('Authorization', authHeader)
        .send({
          name: 'Group Name',
          groupIdMls: 'group-id-mls',
          cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
        });

      expect(response.status).toBe(201);
      expect(mockClientQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('id, organization_id, group_id_mls'),
        expect.arrayContaining([
          'org-1',
          'group-id-mls',
          'Group Name',
          'user-1'
        ])
      );
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/mls/welcome-messages/:id/ack', () => {
    it('binds acknowledgements to both recipient and payload groupId', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const response = await request(app)
        .post('/v1/mls/welcome-messages/welcome-1/ack')
        .set('Authorization', authHeader)
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND group_id = $3'),
        ['welcome-1', 'user-1', 'group-1']
      );
    });
  });

  describe('MLS payload validation hardening', () => {
    it('rejects oversized key package uploads', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      const oversizedBatch = Array.from({ length: 101 }, (_, index) => ({
        keyPackageData: `kp-data-${index}`,
        keyPackageRef: `kp-ref-${index}`,
        cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
      }));

      const response = await request(app)
        .post('/v1/mls/key-packages')
        .set('Authorization', authHeader)
        .send({ keyPackages: oversizedBatch });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid key packages payload' });
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
