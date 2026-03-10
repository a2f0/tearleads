import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const persistVfsBlobDataMock = vi.fn();
const poolQueryMock = vi.fn();
const requireVfsClaimsMock = vi.fn();
const upsertBlobUploadChunkMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsBlobStore.js', () => ({
  persistVfsBlobData: (...args: unknown[]) => persistVfsBlobDataMock(...args)
}));

vi.mock('./vfsDirectBlobUploadSessions.js', () => ({
  upsertBlobUploadChunk: (...args: unknown[]) =>
    upsertBlobUploadChunkMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  stageBlobDirect,
  uploadBlobChunkDirect
} from './vfsDirectBlobStageUpload.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectBlobStageUpload coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    connectMock.mockReset();
    getPostgresPoolMock.mockReset();
    persistVfsBlobDataMock.mockReset();
    poolQueryMock.mockReset();
    requireVfsClaimsMock.mockReset();
    upsertBlobUploadChunkMock.mockReset();

    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: connectMock,
      query: poolQueryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1',
      organizationId: 'org-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects stageBlob when dataBase64 is invalid', async () => {
    await expect(
      stageBlobDirect(
        {
          blobId: 'blob-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          dataBase64: '***invalid***'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns NotFound when blob registry row is missing during stage', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      stageBlobDirect(
        {
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-01-01T00:00:00.000Z'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns conflict when blob id matches a non-file object', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ object_type: 'folder' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      stageBlobDirect(
        {
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-01-01T00:00:00.000Z'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('maps postgres foreign-key errors during stage to NotFound', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ code: '23503' })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      stageBlobDirect(
        {
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-01-01T00:00:00.000Z'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns Internal when staging insert does not return a row', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ object_type: 'file', organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      stageBlobDirect(
        {
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-01-01T00:00:00.000Z'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('persists inline blob data when contentType is omitted', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ object_type: 'file', organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            status: 'staged',
            staged_at: new Date('2026-03-03T00:00:00.000Z'),
            expires_at: new Date('2099-01-01T00:00:00.000Z')
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await stageBlobDirect(
      {
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        dataBase64: 'Zg=='
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(persistVfsBlobDataMock).toHaveBeenCalledWith({
      blobId: 'blob-1',
      data: Buffer.from('f')
    });
  });

  it('maps unexpected stage failures to Internal', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      stageBlobDirect(
        {
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-01-01T00:00:00.000Z'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('rejects upload when stagingId is blank', async () => {
    await expect(
      uploadBlobChunkDirect(
        {
          stagingId: ' ',
          uploadId: '',
          chunkIndex: -1,
          isFinal: true,
          nonce: '',
          aadHash: '',
          ciphertextBase64: '',
          plaintextLength: -1,
          ciphertextLength: -1
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects upload when staged blob is owned by another user', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          staged_by: 'user-2',
          organization_id: 'org-1',
          status: 'staged',
          expires_at: '2099-01-01T00:00:00.000Z'
        }
      ]
    });

    await expect(
      uploadBlobChunkDirect(
        {
          stagingId: 'stage-1',
          uploadId: 'upload-1',
          chunkIndex: 0,
          isFinal: true,
          nonce: 'nonce-1',
          aadHash: 'aad-1',
          ciphertextBase64: 'ZGF0YQ==',
          plaintextLength: 4,
          ciphertextLength: 4
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('maps unexpected upload failures to Internal', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          staged_by: 'user-1',
          organization_id: 'org-1',
          status: 'staged',
          expires_at: '2099-01-01T00:00:00.000Z'
        }
      ]
    });
    upsertBlobUploadChunkMock.mockRejectedValueOnce(new Error('redis write'));

    await expect(
      uploadBlobChunkDirect(
        {
          stagingId: 'stage-1',
          uploadId: 'upload-1',
          chunkIndex: 0,
          isFinal: true,
          nonce: 'nonce-1',
          aadHash: 'aad-1',
          ciphertextBase64: 'ZGF0YQ==',
          plaintextLength: 4,
          ciphertextLength: 4
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
