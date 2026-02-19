import './vfs-test-support.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';
import {
  mockClientRelease,
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfs-test-support.js';

describe('VFS routes (blobs attach conflicts)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('POST /vfs/blobs/stage/:stagingId/attach', () => {
    it('returns 500 when insert conflict fallback cannot find an existing ref', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT ... FOR UPDATE (staging)
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT ref conflict
        .mockResolvedValueOnce({ rows: [] }) // SELECT existing ref missing
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
      expect(mockQuery.mock.calls[7]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });

    it('returns 409 when existing blob link has a different relation kind', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT staging
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT blob link conflict
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'existing-ref-1',
              created_at: '2026-02-14T10:10:01.000Z',
              wrapped_session_key: 'blob-link:photo',
              visible_children: {
                relationKind: 'photo',
                attachedBy: 'user-1'
              }
            }
          ]
        }) // SELECT existing link
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob is already attached with a different relation kind'
      });
      expect(mockQuery.mock.calls[7]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when blob id resolves to non-blob VFS object type', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT staging
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 0
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'note' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob object id conflicts with existing VFS object'
      });
      expect(mockQuery.mock.calls[5]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when staged blob is already attached', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'attached',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer attachable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when staged blob belongs to a different user', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-2',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when staged blob has expired', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2000-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Blob staging has expired' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when staged blob metadata is missing expiresAt', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: null
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
      expect(mockQuery.mock.calls[2]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when update guardrail detects attach race', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({ rows: [] }) // guarded UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer attachable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('rolls back and returns 500 when attach fails mid-transaction', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockRejectedValueOnce(new Error('insert ref failed')) // INSERT blob link
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
      expect(mockQuery.mock.calls[6]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });
  });
});
