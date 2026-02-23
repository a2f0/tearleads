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

describe('VFS Shares routes (DELETE org-share)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
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
});
