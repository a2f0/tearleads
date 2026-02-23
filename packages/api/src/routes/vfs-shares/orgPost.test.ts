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

describe('VFS Shares routes (POST org-share)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
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

    it('returns 400 when sourceOrgId contains acl id separators', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/org-shares')
        .set('Authorization', authHeader)
        .send({
          sourceOrgId: 'org:source',
          targetOrgId: 'org-target',
          permissionLevel: 'view'
        });

      expect(response.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
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
});
