import './vfs-test-support.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfs-test-support.js';

const mockPersistVfsBlobData = vi.fn();
vi.mock('../lib/vfsBlobStore.js', () => ({
  persistVfsBlobData: (...args: unknown[]) => mockPersistVfsBlobData(...args)
}));

describe('VFS routes (blobs stage)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
    mockPersistVfsBlobData.mockReset();
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

    it('persists inbound blob data before staging when dataBase64 is provided', async () => {
      const authHeader = await createAuthHeader();
      const stagedAt = new Date('2026-02-14T10:00:00.000Z');
      const expiresAt = new Date('2026-02-14T11:00:00.000Z');

      mockPersistVfsBlobData.mockResolvedValue({
        bucket: 'test-bucket',
        storageKey: 'blob-1'
      });
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob
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
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: Buffer.from('hello blob').toString('base64'),
          contentType: 'text/plain'
        });

      expect(response.status).toBe(201);
      expect(mockPersistVfsBlobData).toHaveBeenCalledTimes(1);
      expect(mockPersistVfsBlobData.mock.calls[0]?.[0]).toMatchObject({
        blobId: 'blob-1',
        contentType: 'text/plain'
      });
      const persistedData = mockPersistVfsBlobData.mock.calls[0]?.[0] as {
        data: Uint8Array;
      };
      expect(Buffer.from(persistedData.data).toString('utf8')).toBe(
        'hello blob'
      );
    });

    it('returns 400 when inbound dataBase64 is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: '%%%not-base64%%%'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'dataBase64 must be valid base64'
      });
      expect(mockPersistVfsBlobData).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 500 when inbound blob persistence fails', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockPersistVfsBlobData.mockRejectedValueOnce(new Error('storage down'));

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: Buffer.from('hello blob').toString('base64')
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to persist blob data' });
      expect(mockQuery).not.toHaveBeenCalled();
      restoreConsole();
    });

    it('allows retrying the same inbound blob payload after transient storage failures', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      const stagedAt = new Date('2026-02-14T10:00:00.000Z');
      const expiresAt = new Date('2026-02-14T11:00:00.000Z');
      const payload = {
        stagingId: 'stage-retry-1',
        blobId: 'blob-retry-1',
        expiresAt: '2099-02-14T11:00:00.000Z',
        dataBase64: Buffer.from('retryable blob').toString('base64'),
        contentType: 'text/plain'
      };

      mockPersistVfsBlobData
        .mockRejectedValueOnce(new Error('transient storage outage'))
        .mockResolvedValueOnce({
          bucket: 'test-bucket',
          storageKey: 'blob-retry-1'
        });
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-retry-1',
              blob_id: 'blob-retry-1',
              status: 'staged',
              staged_at: stagedAt,
              expires_at: expiresAt
            }
          ]
        }) // INSERT staging link row
        .mockResolvedValueOnce({}); // COMMIT

      const firstAttempt = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send(payload);

      const secondAttempt = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send(payload);

      expect(firstAttempt.status).toBe(500);
      expect(firstAttempt.body).toEqual({
        error: 'Failed to persist blob data'
      });
      expect(secondAttempt.status).toBe(201);
      expect(secondAttempt.body).toEqual({
        stagingId: 'stage-retry-1',
        blobId: 'blob-retry-1',
        status: 'staged',
        stagedAt: '2026-02-14T10:00:00.000Z',
        expiresAt: '2026-02-14T11:00:00.000Z'
      });
      expect(mockPersistVfsBlobData).toHaveBeenCalledTimes(2);
      expect(mockPersistVfsBlobData.mock.calls[0]?.[0]).toMatchObject({
        blobId: 'blob-retry-1',
        contentType: 'text/plain'
      });
      expect(mockPersistVfsBlobData.mock.calls[1]?.[0]).toMatchObject({
        blobId: 'blob-retry-1',
        contentType: 'text/plain'
      });
      restoreConsole();
    });
  });
});
