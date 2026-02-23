import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './testSupport.js';

const mockReadVfsBlobData = vi.fn();
vi.mock('../../lib/vfsBlobStore.js', () => ({
  readVfsBlobData: (...args: unknown[]) => mockReadVfsBlobData(...args),
  persistVfsBlobData: vi.fn(),
  deleteVfsBlobData: vi.fn()
}));

describe('VFS routes (blobs get)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
    mockReadVfsBlobData.mockReset();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('GET /vfs/blobs/:blobId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/vfs/blobs/blob-1');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when blob object is missing', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob object not found' });
      expect(mockReadVfsBlobData).not.toHaveBeenCalled();
    });

    it('returns 409 when blob id resolves to non-blob type', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'file', owner_id: 'user-1' }]
      });

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob object id conflicts with existing VFS object'
      });
      expect(mockReadVfsBlobData).not.toHaveBeenCalled();
    });

    it('returns 403 when blob is owned by a different user', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'blob', owner_id: 'another-user' }]
      });

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
      expect(mockReadVfsBlobData).not.toHaveBeenCalled();
    });

    it('returns blob bytes when read succeeds', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'blob', owner_id: 'user-1' }]
      });
      mockReadVfsBlobData.mockResolvedValueOnce({
        data: Uint8Array.from([104, 101, 108, 108, 111]),
        contentType: 'text/plain'
      });

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toBe('hello');
    });

    it('returns 500 when storage read fails', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'blob', owner_id: 'user-1' }]
      });
      mockReadVfsBlobData.mockRejectedValueOnce(new Error('storage down'));

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to read blob data' });
      restoreConsole();
    });
  });
});
