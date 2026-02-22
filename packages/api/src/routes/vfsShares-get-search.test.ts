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

describe('VFS Shares routes (GET/search)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
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

      const sharesQuerySql = mockQuery.mock.calls[1]?.[0];
      if (typeof sharesQuerySql !== 'string') {
        throw new Error('expected canonical shares query SQL');
      }
      expect(sharesQuerySql).toMatch(/\bvfs_acl_entries\b/u);
      expect(sharesQuerySql).not.toMatch(/\bvfs_shares\b/u);
      expect(sharesQuerySql).not.toMatch(/\bvfs_access\b/u);

      const orgSharesQuerySql = mockQuery.mock.calls[2]?.[0];
      if (typeof orgSharesQuerySql !== 'string') {
        throw new Error('expected canonical org-shares query SQL');
      }
      expect(orgSharesQuerySql).toMatch(/\bvfs_acl_entries\b/u);
      expect(orgSharesQuerySql).not.toMatch(/\borg_shares\b/u);
      expect(orgSharesQuerySql).not.toMatch(/\bvfs_access\b/u);
    });

  it('returns wrapped key metadata for encrypted user shares', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1' }] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-enc',
            item_id: 'item-123',
            share_type: 'user',
            target_id: 'user-456',
            target_name: 'Encrypted User',
            access_level: 'read',
            created_by: 'user-001',
            created_by_email: 'creator@test.com',
            created_at: new Date('2024-01-01'),
            expires_at: null,
            wrapped_session_key: 'base64-encrypted-key',
            wrapped_hierarchical_key: JSON.stringify({
              recipientPublicKeyId: 'pk-user-456',
              senderSignature: 'base64-signature'
            }),
            key_epoch: 2
          }
        ]
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/items/item-123/shares')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.shares).toHaveLength(1);
    expect(response.body.shares[0].wrappedKey).toEqual({
      recipientUserId: 'user-456',
      recipientPublicKeyId: 'pk-user-456',
      keyEpoch: 2,
      encryptedKey: 'base64-encrypted-key',
      senderSignature: 'base64-signature'
    });
  });

  it('returns wrapped key metadata for encrypted org shares', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          acl_id: 'org-share:org-source:orgshare-enc',
          target_org_id: 'org-target',
          item_id: 'item-123',
          access_level: 'read',
          created_by: 'user-001',
          created_by_email: 'creator@test.com',
          created_at: new Date('2024-01-01'),
          expires_at: null,
          source_org_name: 'Source Org',
          target_org_name: 'Target Org',
          wrapped_session_key: 'base64-org-encrypted-key',
          wrapped_hierarchical_key: JSON.stringify({
            recipientPublicKeyId: 'pk-org-target',
            senderSignature: 'base64-org-signature'
          }),
          key_epoch: 7
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/items/item-123/shares')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.orgShares).toHaveLength(1);
    expect(response.body.orgShares[0].wrappedKey).toEqual({
      recipientOrgId: 'org-target',
      recipientPublicKeyId: 'pk-org-target',
      keyEpoch: 7,
      encryptedKey: 'base64-org-encrypted-key',
      senderSignature: 'base64-org-signature'
    });
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
