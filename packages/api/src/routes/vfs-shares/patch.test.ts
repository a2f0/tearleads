import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsSharesTestEnv,
  teardownVfsSharesTestEnv
} from './testSupport.js';

describe('VFS Shares routes (PATCH)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
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
});
