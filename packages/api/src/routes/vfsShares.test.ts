import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

// Mock Redis for session storage
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

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

describe('VFS Shares routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockGetPostgresPool.mockReset();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /vfs/items/:itemId/shares', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/vfs/items/item-123/shares');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when item not found', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Item not found' });
    });

    it('returns 403 when user is not the owner', async () => {
      const authHeader = await createAuthHeader();
      // Item exists but different owner
      mockQuery.mockResolvedValueOnce({
        rows: [{ owner_id: 'different-user' }]
      });

      const response = await request(app)
        .get('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to view shares for this item'
      });
    });

    it('returns 200 with shares when item exists', async () => {
      const authHeader = await createAuthHeader();
      // First query: check item exists (owner_id matches test user)
      mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1' }] });
      // Second query: get shares
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-1',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'user-456',
            target_name: 'Test User',
            access_level: 'read',
            created_by: 'user-001',
            created_by_email: 'creator@test.com',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Third query: get org shares
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.shares).toHaveLength(1);
      expect(response.body.shares[0].id).toBe('share-1');
      expect(response.body.orgShares).toHaveLength(0);
    });

    it('returns 500 when share rows contain malformed ACL ids', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1' }] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'invalid-share-id',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'user-456',
            target_name: 'Test User',
            access_level: 'read',
            created_by: 'user-1',
            created_by_email: 'user-1@test.com',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });

      const response = await request(app)
        .get('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get shares' });
      restoreConsole();
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get shares' });
      restoreConsole();
    });
  });

  describe('POST /vfs/items/:itemId/shares', () => {
    const validPayload = {
      itemId: 'item-123',
      shareType: 'user',
      targetId: 'user-456',
      permissionLevel: 'view'
    };

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({ shareType: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('returns 400 when shareType is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({ ...validPayload, shareType: 'invalid-type' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when permissionLevel is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({ ...validPayload, permissionLevel: 'invalid-perm' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when targetId is empty', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({ ...validPayload, targetId: '   ' });

      expect(response.status).toBe(400);
    });

    it('returns 404 when item not found', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Item not found' });
    });

    it('returns 403 when user is not the owner', async () => {
      const authHeader = await createAuthHeader();
      // Item exists but different owner
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'different-user' }]
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to share this item'
      });
    });

    it('returns 404 when target user not found', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target user not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'user not found' });
      expect(mockQuery.mock.calls[1]?.[0]).toContain(
        'INNER JOIN user_organizations target_uo'
      );
    });

    it('returns 404 when target user is outside caller org scope', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target exists globally but not in a shared org (scoped query returns no rows)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'user not found' });
    });

    it('returns 404 when target group not found', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target group not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({ ...validPayload, shareType: 'group', targetId: 'group-789' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'group not found' });
    });

    it('returns 404 when target org not found', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target org not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({
          ...validPayload,
          shareType: 'organization',
          targetId: 'org-789'
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'organization not found' });
    });

    it('returns 201 when share is created successfully', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target user exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'target@test.com' }]
      });
      // Insert share
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-new',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'user-456',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Creator email
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body.share.id).toBe('share-new');
      expect(response.body.share.shareType).toBe('user');
      expect(mockQuery.mock.calls[1]?.[0]).toContain(
        'INNER JOIN user_organizations target_uo'
      );
      const aclInsertCall = mockQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO vfs_acl_entries')
      );
      expect(aclInsertCall).toBeDefined();
      expect(aclInsertCall?.[1]?.[4]).toBe('read');
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to create share' });
      restoreConsole();
    });
  });

  describe('PATCH /vfs/shares/:shareId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .send({ permissionLevel: 'edit' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'invalid' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when expiresAt is a non-string non-null value', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ expiresAt: 12345 });

      expect(response.status).toBe(400);
    });

    it('returns 400 when body is not an object', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send('not an object');

      expect(response.status).toBe(400);
    });

    it('returns 404 when share not found', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query - share not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'edit' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Share not found' });
    });

    it('returns 403 when user is not the owner', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query - different owner
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'different-user',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'user-456',
            access_level: 'read'
          }
        ]
      });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'edit' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to update this share'
      });
    });

    it('returns 200 when share is updated successfully', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'user-456',
            access_level: 'read'
          }
        ]
      });
      // UPDATE query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-123',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'user-456',
            access_level: 'write',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Target name lookup (user email)
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'target@test.com' }]
      });
      // Creator email lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'edit' });

      expect(response.status).toBe(200);
      expect(response.body.share.permissionLevel).toBe('edit');
      const aclUpdateCall = mockQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE vfs_acl_entries')
      );
      expect(aclUpdateCall).toBeDefined();
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'edit' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to update share' });
      restoreConsole();
    });
  });

  describe('DELETE /vfs/shares/:shareId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).delete('/v1/vfs/shares/share-123');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when share not found', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query - share not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .delete('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Share not found' });
    });

    it('returns 403 when user is not the owner', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query - different owner
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'different-user',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'user-456',
            access_level: 'read'
          }
        ]
      });

      const response = await request(app)
        .delete('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to delete this share'
      });
    });

    it('returns deleted: true when share is deleted successfully', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'user-456',
            access_level: 'read'
          }
        ]
      });
      // DELETE query
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const response = await request(app)
        .delete('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
      const aclRevokeCall = mockQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE vfs_acl_entries')
      );
      expect(aclRevokeCall).toBeDefined();
      expect(aclRevokeCall?.[0]).toContain('revoked_at');
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .delete('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete share' });
      restoreConsole();
    });
  });

  describe('POST /vfs/items/:itemId/org-shares', () => {
    const validPayload = {
      itemId: 'item-123',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      permissionLevel: 'view'
    };

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({ sourceOrgId: 'only-source' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when sourceOrgId is empty', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({ ...validPayload, sourceOrgId: '   ' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when targetOrgId is empty', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({ ...validPayload, targetOrgId: '   ' });

      expect(response.status).toBe(400);
    });

    it('returns 404 when item not found', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Item not found' });
    });

    it('returns 403 when user is not the owner', async () => {
      const authHeader = await createAuthHeader();
      // Item exists but different owner
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'different-user' }]
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to share this item'
      });
    });

    it('returns 404 when source org not found', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Source org not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Source organization not found' });
      expect(mockQuery.mock.calls[1]?.[0]).toContain(
        'INNER JOIN user_organizations uo'
      );
    });

    it('returns 404 when source org is outside caller org scope', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Scoped source-org query returns no rows
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Source organization not found' });
    });

    it('returns 404 when target org not found', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Source org exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Source Org' }]
      });
      // Target org not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Target organization not found' });
    });

    it('returns 201 when org share is created successfully', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Source org exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Source Org' }]
      });
      // Target org exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Target Org' }]
      });
      // Insert org share
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'org-share:org-source:orgshare-new',
            target_org_id: 'org-target',
            item_id: 'item-123',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Creator email
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body.orgShare.id).toBe('orgshare-new');
      expect(response.body.orgShare.sourceOrgId).toBe('org-source');
      expect(response.body.orgShare.targetOrgId).toBe('org-target');
      expect(mockQuery.mock.calls[1]?.[0]).toContain(
        'INNER JOIN user_organizations uo'
      );
      const aclInsertCall = mockQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO vfs_acl_entries')
      );
      expect(aclInsertCall).toBeDefined();
      expect(aclInsertCall?.[1]?.[2]).toBe('organization');
      expect(aclInsertCall?.[1]?.[4]).toBe('read');
    });

    it('uses Unknown when org share creator email is missing', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Source org exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Source Org' }]
      });
      // Target org exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Target Org' }]
      });
      // Insert org share
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'org-share:org-source:orgshare-new',
            target_org_id: 'org-target',
            item_id: 'item-123',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Creator email missing
      mockQuery.mockResolvedValueOnce({
        rows: []
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body.orgShare.createdByEmail).toBe('Unknown');
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to create org share' });
      restoreConsole();
    });
  });

  describe('PATCH /vfs/shares/:shareId edge cases', () => {
    it('returns 200 when updating group share', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'group',
            principal_id: 'group-456',
            access_level: 'write'
          }
        ]
      });
      // UPDATE query with group type
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-123',
            item_id: 'item-123',
            share_type: 'group',
            target_id: 'group-456',
            access_level: 'write',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Target name lookup (group name)
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Test Group' }]
      });
      // Creator email lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'edit' });

      expect(response.status).toBe(200);
      expect(response.body.share.targetName).toBe('Test Group');
    });

    it('returns 200 when updating org share', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'organization',
            principal_id: 'org-456',
            access_level: 'read'
          }
        ]
      });
      // UPDATE query with org type
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-123',
            item_id: 'item-123',
            share_type: 'organization',
            target_id: 'org-456',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Target name lookup (org name)
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Test Org' }]
      });
      // Creator email lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'download' });

      expect(response.status).toBe(200);
      expect(response.body.share.targetName).toBe('Test Org');
    });

    it('returns 200 with expiresAt update', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'user-456',
            access_level: 'read'
          }
        ]
      });
      // UPDATE query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-123',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'user-456',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: new Date('2025-12-31')
          }
        ]
      });
      // Target name lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'target@test.com' }]
      });
      // Creator email lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ expiresAt: '2025-12-31T00:00:00Z' });

      expect(response.status).toBe(200);
      expect(response.body.share.expiresAt).toBeTruthy();
    });

    it('returns 200 when clearing expiresAt', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'user-456',
            access_level: 'read'
          }
        ]
      });
      // UPDATE query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-123',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'user-456',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Target name lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'target@test.com' }]
      });
      // Creator email lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ expiresAt: null });

      expect(response.status).toBe(200);
      expect(response.body.share.expiresAt).toBeNull();
    });

    it('handles missing target name gracefully', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'deleted-user',
            access_level: 'read'
          }
        ]
      });
      // UPDATE query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-123',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'deleted-user',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Target name lookup returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Creator email lookup
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader)
        .send({ permissionLevel: 'edit' });

      expect(response.status).toBe(200);
      expect(response.body.share.targetName).toBe('Unknown');
      expect(response.body.share.createdByEmail).toBe('Unknown');
    });
  });

  describe('POST /vfs/items/:itemId/shares edge cases', () => {
    it('returns 409 when share already exists', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target user exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'target@test.com' }]
      });
      // Insert fails with duplicate key
      mockQuery.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint')
      );

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-123',
          shareType: 'user',
          targetId: 'user-456',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Share already exists' });
      restoreConsole();
    });

    it('creates share for group target', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target group exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Test Group' }]
      });
      // Insert share
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-new',
            item_id: 'item-123',
            share_type: 'group',
            target_id: 'group-456',
            access_level: 'write',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Creator email
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-123',
          shareType: 'group',
          targetId: 'group-456',
          permissionLevel: 'edit'
        });

      expect(response.status).toBe(201);
      expect(response.body.share.shareType).toBe('group');
    });

    it('creates share for org target', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target org exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Test Org' }]
      });
      // Insert share
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-new',
            item_id: 'item-123',
            share_type: 'organization',
            target_id: 'org-456',
            access_level: 'read',
            created_by: 'user-001',
            created_at: new Date('2024-01-01'),
            expires_at: null
          }
        ]
      });
      // Creator email
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'creator@test.com' }]
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-123',
          shareType: 'organization',
          targetId: 'org-456',
          permissionLevel: 'download'
        });

      expect(response.status).toBe(201);
      expect(response.body.share.shareType).toBe('organization');
    });

    it('returns 409 when insert returns empty', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Target user exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ email: 'target@test.com' }]
      });
      // Insert returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-123',
          shareType: 'user',
          targetId: 'user-456',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Share already exists' });
    });

    it('returns 400 when targetId is only whitespace', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({
          shareType: 'user',
          targetId: '   ',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 when targetId is missing', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader)
        .send({
          shareType: 'user',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /vfs/items/:itemId/org-shares edge cases', () => {
    it('returns 409 when org share already exists', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Source org exists
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Source Org' }] });
      // Target org exists
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Target Org' }] });
      // Insert fails with duplicate key
      mockQuery.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint')
      );

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-123',
          sourceOrgId: 'org-source',
          targetOrgId: 'org-target',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Org share already exists' });
      restoreConsole();
    });

    it('returns 409 when insert returns empty', async () => {
      const authHeader = await createAuthHeader();
      // Item exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'user-1' }]
      });
      // Source org exists
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Source Org' }] });
      // Target org exists
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Target Org' }] });
      // Insert returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-123',
          sourceOrgId: 'org-source',
          targetOrgId: 'org-target',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Org share already exists' });
    });

    it('returns 400 when sourceOrgId is only whitespace', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({
          sourceOrgId: '   ',
          targetOrgId: 'org-target',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 when targetOrgId is only whitespace', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({
          sourceOrgId: 'org-source',
          targetOrgId: '   ',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /vfs/org-shares/:shareId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).delete(
        '/v1/vfs/org-shares/orgshare-123'
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when org share not found', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query - share not found
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .delete('/v1/vfs/org-shares/orgshare-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Org share not found' });
    });

    it('returns 403 when user is not the owner', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query - different owner
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'different-user',
            acl_id: 'org-share:org-source:orgshare-123',
            item_id: 'item-123',
            principal_id: 'org-target',
            access_level: 'read'
          }
        ]
      });

      const response = await request(app)
        .delete('/v1/vfs/org-shares/orgshare-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to delete this org share'
      });
    });

    it('returns deleted: true when org share is deleted successfully', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'org-share:org-source:orgshare-123',
            item_id: 'item-123',
            principal_id: 'org-target',
            access_level: 'read'
          }
        ]
      });
      // DELETE query
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const response = await request(app)
        .delete('/v1/vfs/org-shares/orgshare-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
      const aclRevokeCall = mockQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE vfs_acl_entries')
      );
      expect(aclRevokeCall).toBeDefined();
      expect(aclRevokeCall?.[0]).toContain('revoked_at');
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .delete('/v1/vfs/org-shares/orgshare-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete org share' });
      restoreConsole();
    });
  });

  describe('DELETE /vfs/shares/:shareId edge cases', () => {
    it('handles null rowCount', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'share:share-123',
            item_id: 'item-123',
            principal_type: 'user',
            principal_id: 'user-456',
            access_level: 'read'
          }
        ]
      });
      // DELETE query with null rowCount
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: null });

      const response = await request(app)
        .delete('/v1/vfs/shares/share-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: false });
    });
  });

  describe('DELETE /vfs/org-shares/:shareId edge cases', () => {
    it('handles null rowCount', async () => {
      const authHeader = await createAuthHeader();
      // Auth check query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            owner_id: 'user-1',
            acl_id: 'org-share:org-source:orgshare-123',
            item_id: 'item-123',
            principal_id: 'org-target',
            access_level: 'read'
          }
        ]
      });
      // DELETE query with null rowCount
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: null });

      const response = await request(app)
        .delete('/v1/vfs/org-shares/orgshare-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: false });
    });
  });

  describe('GET /vfs/share-targets/search', () => {
    it('returns 400 when query is empty string', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Search query is required'
      });
    });

    it('returns 400 when query is only whitespace', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=%20%20')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Search query is required'
      });
    });

    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get(
        '/v1/vfs/share-targets/search?q=test'
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when query is missing', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .get('/v1/vfs/share-targets/search')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Search query is required'
      });
    });

    it('returns 200 with user results for type=user', async () => {
      const authHeader = await createAuthHeader();
      // User organizations query
      mockQuery.mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      });
      // Users query
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'user-1', email: 'test@example.com' },
          { id: 'user-2', email: 'testuser@example.com' }
        ]
      });

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=test&type=user')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].type).toBe('user');
    });

    it('returns 200 with group results for type=group', async () => {
      const authHeader = await createAuthHeader();
      // User organizations query
      mockQuery.mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      });
      // Groups query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'group-1', name: 'Test Group', org_name: 'Test Org' }]
      });

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=test&type=group')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].type).toBe('group');
      expect(response.body.results[0].name).toBe('Test Group');
    });

    it('returns 200 with org results for type=organization', async () => {
      const authHeader = await createAuthHeader();
      // User organizations query
      mockQuery.mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      });
      // Orgs query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'org-1', name: 'Test Org', description: 'A test org' }]
      });

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=test&type=organization')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].type).toBe('organization');
      expect(response.body.results[0].name).toBe('Test Org');
    });

    it('returns 200 with combined results when no type specified', async () => {
      const authHeader = await createAuthHeader();
      // User organizations query
      mockQuery.mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      });
      // Users query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-1', email: 'test@example.com' }]
      });
      // Groups query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'group-1', name: 'Test Group', org_name: null }]
      });
      // Orgs query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'org-1', name: 'Test Org', description: null }]
      });

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=test')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(3);
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      // User organizations query fails
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=test')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to search' });
      restoreConsole();
    });

    it('ignores invalid type and searches all types', async () => {
      const authHeader = await createAuthHeader();
      // User organizations query
      mockQuery.mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      });
      // Users query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'user-1', email: 'test@example.com' }]
      });
      // Groups query
      mockQuery.mockResolvedValueOnce({
        rows: []
      });
      // Orgs query
      mockQuery.mockResolvedValueOnce({
        rows: []
      });

      const response = await request(app)
        .get('/v1/vfs/share-targets/search?q=test&type=invalid')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].type).toBe('user');
    });
  });
});
