import './vfsShares-test-support.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsSharesTestEnv,
  teardownVfsSharesTestEnv
} from './vfsShares-test-support.js';

describe('VFS Shares routes (POST share)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
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
});
