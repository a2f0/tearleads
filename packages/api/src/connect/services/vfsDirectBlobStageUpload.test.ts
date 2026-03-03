import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clientQueryMock,
  clientReleaseMock,
  connectMock,
  getPostgresPoolMock,
  persistVfsBlobDataMock,
  poolQueryMock,
  requireVfsClaimsMock,
  upsertBlobUploadChunkMock
} = vi.hoisted(() => ({
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  connectMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  persistVfsBlobDataMock: vi.fn(),
  poolQueryMock: vi.fn(),
  requireVfsClaimsMock: vi.fn(),
  upsertBlobUploadChunkMock: vi.fn()
}));

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

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

describe('vfsDirectBlobStageUpload', () => {
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
      sub: 'user-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('stages blob metadata and persists inline base64 data', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ object_type: 'file' }]
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

    const response = await stageBlobDirect(
      {
        json: JSON.stringify({
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          dataBase64: 'ZGF0YQ==',
          contentType: 'application/octet-stream'
        })
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(persistVfsBlobDataMock).toHaveBeenCalledWith({
      blobId: 'blob-1',
      data: Buffer.from('data'),
      contentType: 'application/octet-stream'
    });
    expect(parseJson(response.json)).toEqual({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      status: 'staged',
      stagedAt: '2026-03-03T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z'
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('rejects stageBlob when payload is invalid', async () => {
    await expect(
      stageBlobDirect(
        {
          json: '{}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects stageBlob when expiresAt is not in the future', async () => {
    await expect(
      stageBlobDirect(
        {
          json: JSON.stringify({
            blobId: 'blob-1',
            expiresAt: '2000-01-01T00:00:00.000Z'
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('maps duplicate staging ids to AlreadyExists', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ object_type: 'file' }]
      })
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      stageBlobDirect(
        {
          json: JSON.stringify({
            stagingId: 'stage-1',
            blobId: 'blob-1',
            expiresAt: '2099-01-01T00:00:00.000Z'
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('uploads chunk metadata for staged blob', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          staged_by: 'user-1',
          status: 'staged',
          expires_at: '2099-01-01T00:00:00.000Z'
        }
      ]
    });

    const response = await uploadBlobChunkDirect(
      {
        stagingId: 'stage-1',
        json: JSON.stringify({
          uploadId: 'upload-1',
          chunkIndex: 0,
          isFinal: true,
          nonce: 'nonce-1',
          aadHash: 'aad-1',
          ciphertextBase64: 'ZGF0YQ==',
          plaintextLength: 4,
          ciphertextLength: 4
        })
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(upsertBlobUploadChunkMock).toHaveBeenCalledWith({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      chunk: {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'ZGF0YQ==',
        plaintextLength: 4,
        ciphertextLength: 4
      }
    });
    expect(parseJson(response.json)).toEqual({
      accepted: true,
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      chunkIndex: 0
    });
  });

  it('rejects upload when chunk payload is invalid', async () => {
    await expect(
      uploadBlobChunkDirect(
        {
          stagingId: 'stage-1',
          json: '{}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it('rejects upload when staging row is missing', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      uploadBlobChunkDirect(
        {
          stagingId: 'stage-missing',
          json: JSON.stringify({
            uploadId: 'upload-1',
            chunkIndex: 0,
            isFinal: true,
            nonce: 'nonce-1',
            aadHash: 'aad-1',
            ciphertextBase64: 'ZGF0YQ==',
            plaintextLength: 4,
            ciphertextLength: 4
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('rejects upload when staging state is no longer uploadable', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          staged_by: 'user-1',
          status: 'attached',
          expires_at: '2099-01-01T00:00:00.000Z'
        }
      ]
    });

    await expect(
      uploadBlobChunkDirect(
        {
          stagingId: 'stage-1',
          json: JSON.stringify({
            uploadId: 'upload-1',
            chunkIndex: 0,
            isFinal: true,
            nonce: 'nonce-1',
            aadHash: 'aad-1',
            ciphertextBase64: 'ZGF0YQ==',
            plaintextLength: 4,
            ciphertextLength: 4
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });
});
