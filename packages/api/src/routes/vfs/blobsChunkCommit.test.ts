import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { clearBlobUploadSessions } from './blobUploadSessions.js';
import {
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './testSupport.js';

const mockPersistVfsBlobData = vi.fn();
vi.mock('../../lib/vfsBlobStore.js', () => ({
  persistVfsBlobData: (...args: unknown[]) => mockPersistVfsBlobData(...args)
}));

describe('VFS routes (blob chunk + commit)', () => {
  beforeEach(async () => {
    setupVfsTestEnv();
    await clearBlobUploadSessions();
    mockPersistVfsBlobData.mockReset();
  });

  afterEach(async () => {
    await clearBlobUploadSessions();
    teardownVfsTestEnv();
  });

  it('returns 401 for chunk uploads when unauthenticated', async () => {
    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/chunks')
      .send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('accepts chunk uploads and commits merged ciphertext', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ staged_by: 'user-1', status: 'staged' }]
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ blob_id: 'blob-1', staged_by: 'user-1', status: 'staged' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            visible_children: {
              chunkIndex: 0,
              isFinal: true,
              ciphertextBase64: 'Y2lwaGVydGV4dA==',
              plaintextLength: 10,
              ciphertextLength: 10
            }
          }
        ]
      });
    mockQuery.mockResolvedValueOnce({});

    mockPersistVfsBlobData.mockResolvedValue({
      bucket: 'bucket',
      storageKey: 'blob-1'
    });

    const chunkResponse = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/chunks')
      .set('Authorization', authHeader)
      .send({
        uploadId: 'upload-1',
        chunkIndex: 0,
        isFinal: true,
        nonce: 'nonce-1',
        aadHash: 'aad-1',
        ciphertextBase64: 'Y2lwaGVydGV4dA==',
        plaintextLength: 10,
        ciphertextLength: 10
      });

    expect(chunkResponse.status).toBe(200);
    expect(chunkResponse.body).toEqual({
      accepted: true,
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      chunkIndex: 0
    });

    const commitResponse = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/commit')
      .set('Authorization', authHeader)
      .send({
        uploadId: 'upload-1',
        keyEpoch: 1,
        manifestHash: 'hash-1',
        manifestSignature: 'sig-1',
        chunkCount: 1,
        totalPlaintextBytes: 10,
        totalCiphertextBytes: 10
      });

    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body).toEqual({
      committed: true,
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      blobId: 'blob-1'
    });
    expect(mockPersistVfsBlobData).toHaveBeenCalledWith(
      expect.objectContaining({
        blobId: 'blob-1',
        data: expect.any(Uint8Array)
      })
    );
  });

  it('returns 409 when commit is requested before any chunks are uploaded', async () => {
    const authHeader = await createAuthHeader();

    mockQuery.mockResolvedValueOnce({
      rows: [{ blob_id: 'blob-1', staged_by: 'user-1', status: 'staged' }]
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/commit')
      .set('Authorization', authHeader)
      .send({
        uploadId: 'upload-missing',
        keyEpoch: 1,
        manifestHash: 'hash-1',
        manifestSignature: 'sig-1',
        chunkCount: 1,
        totalPlaintextBytes: 10,
        totalCiphertextBytes: 10
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'No uploaded chunks found for staging'
    });
  });
});
