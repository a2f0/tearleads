import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clientQueryMock,
  clientReleaseMock,
  deleteVfsBlobDataMock,
  getPoolMock,
  getPostgresPoolMock,
  poolQueryMock,
  readVfsBlobDataMock,
  requireVfsClaimsMock
} = vi.hoisted(() => ({
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  deleteVfsBlobDataMock: vi.fn(),
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  poolQueryMock: vi.fn(),
  readVfsBlobDataMock: vi.fn(),
  requireVfsClaimsMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsBlobStore.js', () => ({
  deleteVfsBlobData: (...args: unknown[]) => deleteVfsBlobDataMock(...args),
  readVfsBlobData: (...args: unknown[]) => readVfsBlobDataMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { deleteBlobDirect, getBlobDirect } from './vfsDirectBlobs.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

describe('vfsDirectBlobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQueryMock.mockReset();
    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    deleteVfsBlobDataMock.mockReset();
    readVfsBlobDataMock.mockReset();
    requireVfsClaimsMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: poolQueryMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: clientReleaseMock
      })
    });

    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
    readVfsBlobDataMock.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns blob bytes for authorized owner', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          object_type: 'file',
          owner_id: 'user-1'
        }
      ]
    });

    const response = await getBlobDirect(
      {
        blobId: 'blob-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      data: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream'
    });
    expect(readVfsBlobDataMock).toHaveBeenCalledWith({
      blobId: 'blob-1'
    });
  });

  it('returns not found when blob registry row does not exist', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getBlobDirect(
        {
          blobId: 'missing-blob'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns permission denied when caller is not owner', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          object_type: 'file',
          owner_id: 'user-2'
        }
      ]
    });

    await expect(
      getBlobDirect(
        {
          blobId: 'blob-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('deletes blob when not attached and caller owns it', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            object_type: 'file',
            owner_id: 'user-1'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    const response = await deleteBlobDirect(
      {
        blobId: 'blob-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      deleted: true,
      blobId: 'blob-1'
    });
    expect(deleteVfsBlobDataMock).toHaveBeenCalledWith({
      blobId: 'blob-1'
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('returns AlreadyExists when blob is attached', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            object_type: 'file',
            owner_id: 'user-1'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ one: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      deleteBlobDirect(
        {
          blobId: 'blob-2'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });

    expect(deleteVfsBlobDataMock).not.toHaveBeenCalled();
    expect(clientReleaseMock).toHaveBeenCalled();
  });
});
