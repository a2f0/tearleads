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

/**
 * Phase D: Persistence-layer gap closure contract tests
 *
 * These tests verify the boundary contract between API routes and the S3 blob
 * storage adapter, covering:
 * - Object-key mismatch scenarios (orphaned metadata vs missing S3 objects)
 * - S3-specific error code handling
 * - Metadata/object alignment guarantees
 * - Transient storage unavailability with retry-safe behavior
 */

const mockReadVfsBlobData = vi.fn();
const mockDeleteVfsBlobData = vi.fn();
const mockPersistVfsBlobData = vi.fn();

vi.mock('../../lib/vfsBlobStore.js', () => ({
  readVfsBlobData: (...args: unknown[]) => mockReadVfsBlobData(...args),
  deleteVfsBlobData: (...args: unknown[]) => mockDeleteVfsBlobData(...args),
  persistVfsBlobData: (...args: unknown[]) => mockPersistVfsBlobData(...args)
}));

/**
 * S3-style error interface matching AWS SDK error structure
 */
interface S3Error extends Error {
  name: string;
  $metadata?: { httpStatusCode: number };
  Code?: string;
}

/**
 * Helper to create S3-style errors with AWS SDK error structure
 */
function createS3Error(
  code: string,
  message: string,
  statusCode?: number
): S3Error {
  const error = new Error(message) as S3Error;
  error.name = code;
  error.Code = code;
  if (statusCode) {
    error.$metadata = { httpStatusCode: statusCode };
  }
  return error;
}

describe('VFS blob persistence contract tests', () => {
  beforeEach(() => {
    setupVfsTestEnv();
    mockReadVfsBlobData.mockReset();
    mockDeleteVfsBlobData.mockReset();
    mockPersistVfsBlobData.mockReset();
    mockConsoleError();
  });

  afterEach(() => {
    teardownVfsTestEnv();
    vi.restoreAllMocks();
  });

  describe('object-key mismatch: orphaned metadata scenarios', () => {
    it('returns 500 when blob exists in registry but S3 returns NoSuchKey', async () => {
      const authHeader = await createAuthHeader();

      // Registry says blob exists
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'file', owner_id: 'user-1' }]
      });

      // But S3 returns NoSuchKey (object was deleted or never uploaded)
      mockReadVfsBlobData.mockRejectedValueOnce(
        createS3Error('NoSuchKey', 'The specified key does not exist.', 404)
      );

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-orphaned-metadata')
        .set('Authorization', authHeader);

      // Should return 500 (not 404) because metadata exists - this is an inconsistency
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to read blob data' });
      expect(mockReadVfsBlobData).toHaveBeenCalledWith({
        blobId: 'blob-orphaned-metadata'
      });
    });

    it('surfaces S3 AccessDenied as 500 error on read', async () => {
      const authHeader = await createAuthHeader();

      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'file', owner_id: 'user-1' }]
      });
      mockReadVfsBlobData.mockRejectedValueOnce(
        createS3Error('AccessDenied', 'Access Denied', 403)
      );

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-access-denied')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to read blob data' });
    });

    it('surfaces S3 NoSuchKey as 500 error on delete when registry exists', async () => {
      const authHeader = await createAuthHeader();

      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file', owner_id: 'user-1' }]
        }) // SELECT registry
        .mockResolvedValueOnce({ rows: [] }) // SELECT attached links
        .mockResolvedValueOnce({}); // ROLLBACK

      // S3 delete fails because object doesn't exist
      mockDeleteVfsBlobData.mockRejectedValueOnce(
        createS3Error('NoSuchKey', 'The specified key does not exist.', 404)
      );

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-already-deleted')
        .set('Authorization', authHeader);

      // Delete should fail with 500 because registry says blob exists
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete blob data' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('S3-specific error handling', () => {
    it('handles S3 ServiceUnavailable error on write', async () => {
      const authHeader = await createAuthHeader();

      mockPersistVfsBlobData.mockRejectedValueOnce(
        createS3Error(
          'ServiceUnavailable',
          'Service is temporarily unavailable',
          503
        )
      );

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-s3-unavailable',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: Buffer.from('test data').toString('base64')
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to persist blob data' });
    });

    it('handles S3 SlowDown (throttling) error on write', async () => {
      const authHeader = await createAuthHeader();

      mockPersistVfsBlobData.mockRejectedValueOnce(
        createS3Error('SlowDown', 'Reduce your request rate', 503)
      );

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-throttled',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: Buffer.from('throttled data').toString('base64')
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to persist blob data' });
    });

    it('handles S3 InternalError on read', async () => {
      const authHeader = await createAuthHeader();

      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'file', owner_id: 'user-1' }]
      });
      mockReadVfsBlobData.mockRejectedValueOnce(
        createS3Error('InternalError', 'We encountered an internal error', 500)
      );

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-internal-error')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to read blob data' });
    });

    it('handles S3 InternalError on delete', async () => {
      const authHeader = await createAuthHeader();

      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file', owner_id: 'user-1' }]
        }) // SELECT registry
        .mockResolvedValueOnce({ rows: [] }) // SELECT attached links
        .mockResolvedValueOnce({}); // ROLLBACK

      mockDeleteVfsBlobData.mockRejectedValueOnce(
        createS3Error('InternalError', 'We encountered an internal error', 500)
      );

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-delete-internal-error')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete blob data' });
    });
  });

  describe('transient storage unavailability with retry-safe behavior', () => {
    it('allows retry after S3 ServiceUnavailable on write', async () => {
      const authHeader = await createAuthHeader();
      const stagedAt = new Date('2026-02-20T10:00:00.000Z');
      const expiresAt = new Date('2026-02-20T11:00:00.000Z');

      // First attempt fails with ServiceUnavailable
      mockPersistVfsBlobData.mockRejectedValueOnce(
        createS3Error(
          'ServiceUnavailable',
          'Service is temporarily unavailable',
          503
        )
      );

      const firstResponse = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-retry-s3',
          blobId: 'blob-retry-s3',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: Buffer.from('retry data').toString('base64')
        });

      expect(firstResponse.status).toBe(500);

      // Second attempt succeeds
      mockPersistVfsBlobData.mockResolvedValueOnce({
        bucket: 'test-bucket',
        storageKey: 'blob-retry-s3'
      });
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-retry-s3',
              blob_id: 'blob-retry-s3',
              status: 'staged',
              staged_at: stagedAt,
              expires_at: expiresAt
            }
          ]
        }) // INSERT staging link row
        .mockResolvedValueOnce({}); // COMMIT

      const secondResponse = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-retry-s3',
          blobId: 'blob-retry-s3',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: Buffer.from('retry data').toString('base64')
        });

      expect(secondResponse.status).toBe(201);
      expect(mockPersistVfsBlobData).toHaveBeenCalledTimes(2);
      // Both calls use same blobId (deterministic key derivation)
      expect(mockPersistVfsBlobData.mock.calls[0]?.[0]).toMatchObject({
        blobId: 'blob-retry-s3'
      });
      expect(mockPersistVfsBlobData.mock.calls[1]?.[0]).toMatchObject({
        blobId: 'blob-retry-s3'
      });
    });

    it('allows retry after S3 SlowDown on read', async () => {
      const authHeader = await createAuthHeader();

      // First attempt - registry exists, S3 throttled
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'file', owner_id: 'user-1' }]
      });
      mockReadVfsBlobData.mockRejectedValueOnce(
        createS3Error('SlowDown', 'Reduce your request rate', 503)
      );

      const firstResponse = await request(app)
        .get('/v1/vfs/blobs/blob-throttled-read')
        .set('Authorization', authHeader);

      expect(firstResponse.status).toBe(500);

      // Second attempt succeeds
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'file', owner_id: 'user-1' }]
      });
      mockReadVfsBlobData.mockResolvedValueOnce({
        data: Uint8Array.from([116, 101, 115, 116]),
        contentType: 'text/plain'
      });

      const secondResponse = await request(app)
        .get('/v1/vfs/blobs/blob-throttled-read')
        .set('Authorization', authHeader);

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.text).toBe('test');
      expect(mockReadVfsBlobData).toHaveBeenCalledTimes(2);
      // Both calls use same blobId (deterministic key)
      expect(mockReadVfsBlobData.mock.calls[0]?.[0]).toEqual({
        blobId: 'blob-throttled-read'
      });
      expect(mockReadVfsBlobData.mock.calls[1]?.[0]).toEqual({
        blobId: 'blob-throttled-read'
      });
    });
  });

  describe('metadata/object alignment boundary contract', () => {
    it('uses consistent blobId for storage key derivation across operations', async () => {
      const authHeader = await createAuthHeader();
      const blobId = 'blob-consistent-key';

      // Stage with data
      mockPersistVfsBlobData.mockResolvedValueOnce({
        bucket: 'test-bucket',
        storageKey: blobId
      });
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file' }]
        }) // SELECT blob registry
        .mockResolvedValueOnce({}) // INSERT staging registry
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-consistent',
              blob_id: blobId,
              status: 'staged',
              staged_at: new Date(),
              expires_at: new Date(Date.now() + 3600000)
            }
          ]
        }) // INSERT staging link
        .mockResolvedValueOnce({}); // COMMIT

      await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-consistent',
          blobId,
          expiresAt: '2099-01-01T00:00:00.000Z',
          dataBase64: Buffer.from('consistent').toString('base64')
        });

      // Read
      mockQuery.mockResolvedValueOnce({
        rows: [{ object_type: 'file', owner_id: 'user-1' }]
      });
      mockReadVfsBlobData.mockResolvedValueOnce({
        data: Uint8Array.from([
          99, 111, 110, 115, 105, 115, 116, 101, 110, 116
        ]),
        contentType: 'application/octet-stream'
      });

      await request(app)
        .get(`/v1/vfs/blobs/${blobId}`)
        .set('Authorization', authHeader);

      // Delete
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file', owner_id: 'user-1' }]
        }) // SELECT registry
        .mockResolvedValueOnce({ rows: [] }) // SELECT attached links
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE registry
        .mockResolvedValueOnce({}); // COMMIT
      mockDeleteVfsBlobData.mockResolvedValueOnce(undefined);

      await request(app)
        .delete(`/v1/vfs/blobs/${blobId}`)
        .set('Authorization', authHeader);

      // Verify all operations used the same blobId
      expect(mockPersistVfsBlobData).toHaveBeenCalledWith(
        expect.objectContaining({ blobId })
      );
      expect(mockReadVfsBlobData).toHaveBeenCalledWith({ blobId });
      expect(mockDeleteVfsBlobData).toHaveBeenCalledWith({ blobId });
    });

    it('does not call storage adapter when registry check fails', async () => {
      const authHeader = await createAuthHeader();

      // Registry says blob doesn't exist
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/blobs/blob-no-registry')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(mockReadVfsBlobData).not.toHaveBeenCalled();
    });

    it('does not call storage delete when ownership check fails', async () => {
      const authHeader = await createAuthHeader();

      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file', owner_id: 'other-user' }]
        }) // SELECT registry - different owner
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .delete('/v1/vfs/blobs/blob-wrong-owner')
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
      expect(mockDeleteVfsBlobData).not.toHaveBeenCalled();
    });
  });
});
