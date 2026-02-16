import './vfs-test-support.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfs-test-support.js';

describe('VFS routes (blobs stage)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('POST /vfs/blobs/stage', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).post('/v1/vfs/blobs/stage').send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({ blobId: 'blob-1' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'blobId and expiresAt are required'
      });
    });

    it('returns 400 when expiresAt is in the past', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2020-01-01T00:00:00.000Z'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'expiresAt must be in the future'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 201 when blob staging is created', async () => {
      const authHeader = await createAuthHeader();
      const stagedAt = new Date('2026-02-14T10:00:00.000Z');
      const expiresAt = new Date('2026-02-14T11:00:00.000Z');
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              status: 'staged',
              staged_at: stagedAt,
              expires_at: expiresAt
            }
          ]
        }) // INSERT staging link row
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        stagingId: 'stage-1',
        blobId: 'blob-1',
        status: 'staged',
        stagedAt: '2026-02-14T10:00:00.000Z',
        expiresAt: '2026-02-14T11:00:00.000Z'
      });
    });

    it('normalizes string timestamps returned from database', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-2',
              blob_id: 'blob-2',
              status: 'staged',
              staged_at: '2026-02-14T10:00:00.000Z',
              expires_at: '2026-02-14T11:00:00.000Z'
            }
          ]
        }) // INSERT staging link row
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-2',
          blobId: 'blob-2',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        stagingId: 'stage-2',
        blobId: 'blob-2',
        status: 'staged',
        stagedAt: '2026-02-14T10:00:00.000Z',
        expiresAt: '2026-02-14T11:00:00.000Z'
      });
    });

    it('returns 500 when insert returns no row', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT staging link row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to stage blob' });
      restoreConsole();
    });

    it('returns 404 when blob object does not exist', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT blob registry row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-missing',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob object not found' });
    });

    it('returns 409 when staging id already exists', async () => {
      const authHeader = await createAuthHeader();
      const conflictError = Object.assign(new Error('duplicate'), {
        code: '23505'
      });
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockRejectedValueOnce(conflictError) // INSERT stage registry
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Blob staging already exists' });
    });

    it('returns 500 on unexpected stage error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockRejectedValueOnce(new Error('db unavailable')) // INSERT stage registry
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to stage blob' });
      restoreConsole();
    });

    it('returns 409 when blob id resolves to a non-blob object', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'note' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob object id conflicts with existing VFS object'
      });
    });
  });
});
