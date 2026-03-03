import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clientQueryMock,
  clientReleaseMock,
  connectMock,
  deleteBlobUploadSessionMock,
  deleteBlobUploadSessionsForStagingMock,
  getBlobUploadChunksMock,
  getPostgresPoolMock,
  persistVfsBlobDataMock,
  requireVfsClaimsMock
} = vi.hoisted(() => ({
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  connectMock: vi.fn(),
  deleteBlobUploadSessionMock: vi.fn(),
  deleteBlobUploadSessionsForStagingMock: vi.fn(),
  getBlobUploadChunksMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  persistVfsBlobDataMock: vi.fn(),
  requireVfsClaimsMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsBlobStore.js', () => ({
  persistVfsBlobData: (...args: unknown[]) => persistVfsBlobDataMock(...args)
}));

vi.mock('../../routes/vfs/blobUploadSessions.js', () => ({
  deleteBlobUploadSession: (...args: unknown[]) =>
    deleteBlobUploadSessionMock(...args),
  deleteBlobUploadSessionsForStaging: (...args: unknown[]) =>
    deleteBlobUploadSessionsForStagingMock(...args),
  getBlobUploadChunks: (...args: unknown[]) => getBlobUploadChunksMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  abandonBlobDirect,
  commitBlobDirect
} from './vfsDirectBlobFinalize.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectBlobFinalize coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    connectMock.mockReset();
    deleteBlobUploadSessionMock.mockReset();
    deleteBlobUploadSessionsForStagingMock.mockReset();
    getBlobUploadChunksMock.mockReset();
    getPostgresPoolMock.mockReset();
    persistVfsBlobDataMock.mockReset();
    requireVfsClaimsMock.mockReset();

    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: connectMock,
      query: clientQueryMock
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

  it('rejects abandon when stagingId is blank', async () => {
    await expect(
      abandonBlobDirect(
        {
          stagingId: ' ',
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

  it('rejects abandon when caller is not owner', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            staged_by: 'user-2',
            status: 'staged'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      abandonBlobDirect(
        {
          stagingId: 'stage-1',
          json: '{}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('rejects abandon when status transition update affects no rows', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            staged_by: 'user-1',
            status: 'staged'
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      abandonBlobDirect(
        {
          stagingId: 'stage-1',
          json: '{}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('maps unexpected abandon failures to Internal', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            staged_by: 'user-1',
            status: 'staged'
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockRejectedValueOnce(new Error('delete failure'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      abandonBlobDirect(
        {
          stagingId: 'stage-1',
          json: '{}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('rejects commit when stagingId is blank', async () => {
    await expect(
      commitBlobDirect(
        {
          stagingId: ' ',
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

  it('rejects commit when caller is not stage owner', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          blob_id: 'blob-1',
          staged_by: 'user-2',
          status: 'staged'
        }
      ]
    });

    await expect(
      commitBlobDirect(
        {
          stagingId: 'stage-1',
          json: JSON.stringify({
            uploadId: 'upload-1',
            keyEpoch: 1,
            manifestHash: 'hash-1',
            manifestSignature: 'sig-1',
            chunkCount: 1,
            totalPlaintextBytes: 4,
            totalCiphertextBytes: 4
          })
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('rejects commit when chunks are not contiguous from index 0', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          blob_id: 'blob-1',
          staged_by: 'user-1',
          status: 'staged'
        }
      ]
    });
    getBlobUploadChunksMock.mockResolvedValueOnce([
      {
        chunkIndex: 1,
        isFinal: true,
        ciphertextBase64: 'ZGF0YQ==',
        plaintextLength: 4,
        ciphertextLength: 4
      }
    ]);

    await expect(
      commitBlobDirect(
        {
          stagingId: 'stage-1',
          json: JSON.stringify({
            uploadId: 'upload-1',
            keyEpoch: 1,
            manifestHash: 'hash-1',
            manifestSignature: 'sig-1',
            chunkCount: 1,
            totalPlaintextBytes: 4,
            totalCiphertextBytes: 4
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

  it('rejects commit when chunk ciphertext length mismatches metadata', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          blob_id: 'blob-1',
          staged_by: 'user-1',
          status: 'staged'
        }
      ]
    });
    getBlobUploadChunksMock.mockResolvedValueOnce([
      {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'ZGF0YQ==',
        plaintextLength: 4,
        ciphertextLength: 10
      }
    ]);

    await expect(
      commitBlobDirect(
        {
          stagingId: 'stage-1',
          json: JSON.stringify({
            uploadId: 'upload-1',
            keyEpoch: 1,
            manifestHash: 'hash-1',
            manifestSignature: 'sig-1',
            chunkCount: 1,
            totalPlaintextBytes: 4,
            totalCiphertextBytes: 4
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

  it('maps unexpected commit persistence errors to Internal', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          blob_id: 'blob-1',
          staged_by: 'user-1',
          status: 'staged'
        }
      ]
    });
    getBlobUploadChunksMock.mockResolvedValueOnce([
      {
        chunkIndex: 0,
        isFinal: true,
        ciphertextBase64: 'ZGF0YQ==',
        plaintextLength: 4,
        ciphertextLength: 4
      }
    ]);
    persistVfsBlobDataMock.mockRejectedValueOnce(new Error('store failure'));

    await expect(
      commitBlobDirect(
        {
          stagingId: 'stage-1',
          json: JSON.stringify({
            uploadId: 'upload-1',
            keyEpoch: 1,
            manifestHash: 'hash-1',
            manifestSignature: 'sig-1',
            chunkCount: 1,
            totalPlaintextBytes: 4,
            totalCiphertextBytes: 4
          })
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
