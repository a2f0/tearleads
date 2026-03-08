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

vi.mock('./vfsDirectBlobUploadSessions.js', () => ({
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

describe('vfsDirectBlobFinalize', () => {
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

  it('abandons staged blob and clears upload sessions', async () => {
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
      .mockResolvedValueOnce({ rows: [] });

    const response = await abandonBlobDirect(
      {
        stagingId: 'stage-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(deleteBlobUploadSessionsForStagingMock).toHaveBeenCalledWith({
      stagingId: 'stage-1'
    });
    expect(response).toEqual({
      abandoned: true,
      stagingId: 'stage-1',
      status: 'abandoned'
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('rejects abandon when staging row is missing', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      abandonBlobDirect(
        {
          stagingId: 'missing'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('rejects abandon when staging is no longer abandonable', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            staged_by: 'user-1',
            status: 'attached'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      abandonBlobDirect(
        {
          stagingId: 'stage-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('commits uploaded chunks into blob storage', async () => {
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

    const response = await commitBlobDirect(
      {
        stagingId: 'stage-1',
        uploadId: 'upload-1',
        keyEpoch: 1,
        manifestHash: 'hash-1',
        manifestSignature: 'sig-1',
        chunkCount: 1,
        totalPlaintextBytes: 4,
        totalCiphertextBytes: 4
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(persistVfsBlobDataMock).toHaveBeenCalledWith({
      blobId: 'blob-1',
      data: new Uint8Array([100, 97, 116, 97])
    });
    expect(deleteBlobUploadSessionMock).toHaveBeenCalledWith({
      stagingId: 'stage-1',
      uploadId: 'upload-1'
    });
    expect(response).toEqual({
      committed: true,
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      blobId: 'blob-1'
    });
  });

  it('rejects commit when payload is invalid', async () => {
    await expect(
      commitBlobDirect(
        {
          stagingId: 'stage-1',
          uploadId: '',
          keyEpoch: 0,
          manifestHash: '',
          manifestSignature: '',
          chunkCount: 0,
          totalPlaintextBytes: -1,
          totalCiphertextBytes: -1
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects commit when no uploaded chunks exist', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          blob_id: 'blob-1',
          staged_by: 'user-1',
          status: 'staged'
        }
      ]
    });
    getBlobUploadChunksMock.mockResolvedValueOnce([]);

    await expect(
      commitBlobDirect(
        {
          stagingId: 'stage-1',
          uploadId: 'upload-1',
          keyEpoch: 1,
          manifestHash: 'hash-1',
          manifestSignature: 'sig-1',
          chunkCount: 1,
          totalPlaintextBytes: 4,
          totalCiphertextBytes: 4
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('rejects commit when uploaded chunk base64 is invalid', async () => {
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
        ciphertextBase64: 'not base64',
        plaintextLength: 4,
        ciphertextLength: 4
      }
    ]);

    await expect(
      commitBlobDirect(
        {
          stagingId: 'stage-1',
          uploadId: 'upload-1',
          keyEpoch: 1,
          manifestHash: 'hash-1',
          manifestSignature: 'sig-1',
          chunkCount: 1,
          totalPlaintextBytes: 4,
          totalCiphertextBytes: 4
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });
});
