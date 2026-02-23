import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockClientRelease,
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './testSupport.js';

const mockDeleteVfsBlobData = vi.fn();
vi.mock('../../lib/vfsBlobStore.js', () => ({
  deleteVfsBlobData: (...args: unknown[]) => mockDeleteVfsBlobData(...args),
  readVfsBlobData: vi.fn(),
  persistVfsBlobData: vi.fn()
}));

describe('VFS routes (blobs delete)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
    mockDeleteVfsBlobData.mockReset();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('DELETE /vfs/blobs/:blobId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).delete('/v1/vfs/blobs/blob-1');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when blob object is missing', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT registry
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob object not found' });
      expect(mockDeleteVfsBlobData).not.toHaveBeenCalled();
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when blob id resolves to non-blob type', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file', owner_id: 'user-1' }]
        }) // SELECT registry
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob object id conflicts with existing VFS object'
      });
      expect(mockDeleteVfsBlobData).not.toHaveBeenCalled();
    });

    it('returns 403 when blob is owned by a different user', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob', owner_id: 'another-user' }]
        }) // SELECT registry
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
      expect(mockDeleteVfsBlobData).not.toHaveBeenCalled();
    });

    it('returns 409 when blob is attached', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob', owner_id: 'user-1' }]
        }) // SELECT registry
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // SELECT attached links
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob is attached and cannot be deleted'
      });
      expect(mockDeleteVfsBlobData).not.toHaveBeenCalled();
    });

    it('returns 200 when blob delete succeeds', async () => {
      const authHeader = await createAuthHeader();
      mockDeleteVfsBlobData.mockResolvedValueOnce(undefined);
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob', owner_id: 'user-1' }]
        }) // SELECT registry
        .mockResolvedValueOnce({ rows: [] }) // SELECT attached links
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE registry
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true, blobId: 'blob-1' });
      expect(mockDeleteVfsBlobData).toHaveBeenCalledWith({ blobId: 'blob-1' });
    });

    it('returns 500 when storage delete fails', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockDeleteVfsBlobData.mockRejectedValueOnce(new Error('storage down'));
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob', owner_id: 'user-1' }]
        }) // SELECT registry
        .mockResolvedValueOnce({ rows: [] }) // SELECT attached links
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete blob data' });
      restoreConsole();
    });
  });
});
