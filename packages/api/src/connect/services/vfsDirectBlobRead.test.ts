import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolMock = vi.fn();
const queryMock = vi.fn();
const readVfsBlobDataMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('../../lib/vfsBlobStore.js', () => ({
  readVfsBlobData: (...args: unknown[]) => readVfsBlobDataMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  getBlobChunkDirect,
  getBlobManifestDirect
} from './vfsDirectBlobRead.js';

describe('vfsDirectBlobRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    readVfsBlobDataMock.mockReset();
    requireVfsClaimsMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
  });

  it('authorizes manifest reads through visible blob refs', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ ref_count: 2, accessible_ref_count: 1 }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            key_epoch: 3,
            chunk_count: 1,
            total_plaintext_bytes: 12,
            total_ciphertext_bytes: 24,
            chunk_hashes: ['hash-1'],
            chunk_boundaries: [{ offset: 0, length: 24, plaintextLength: 12 }],
            manifest_hash: 'manifest-hash',
            manifest_signature: 'manifest-signature'
          }
        ]
      });

    await expect(
      getBlobManifestDirect(
        { blobId: 'blob-1' },
        { requestHeader: new Headers() }
      )
    ).resolves.toEqual({
      blobId: 'blob-1',
      keyEpoch: 3,
      chunkCount: 1,
      totalPlaintextBytes: 12,
      totalCiphertextBytes: 24,
      chunkHashes: ['hash-1'],
      manifestHash: 'manifest-hash',
      manifestSignature: 'manifest-signature'
    });
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM vfs_blob_refs br'),
      ['blob-1', 'user-1']
    );
  });

  it('rejects chunk reads when blob exists but user has no visible refs', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ ref_count: 1, accessible_ref_count: 0 }]
    });

    await expect(
      getBlobChunkDirect(
        { blobId: 'blob-1', chunkIndex: 0 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
    expect(readVfsBlobDataMock).not.toHaveBeenCalled();
  });

  it('returns chunk data with correct byte-range slicing', async () => {
    const blobBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);

    queryMock
      .mockResolvedValueOnce({
        rows: [{ ref_count: 1, accessible_ref_count: 1 }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            chunk_count: 2,
            chunk_boundaries: [
              {
                offset: 0,
                length: 4,
                plaintextLength: 3,
                nonce: 'nonce-0',
                aadHash: 'aad-0'
              },
              {
                offset: 4,
                length: 4,
                plaintextLength: 3,
                nonce: 'nonce-1',
                aadHash: 'aad-1'
              }
            ]
          }
        ]
      });

    readVfsBlobDataMock.mockResolvedValueOnce({ data: blobBytes });

    const result = await getBlobChunkDirect(
      { blobId: 'blob-1', chunkIndex: 1 },
      { requestHeader: new Headers() }
    );

    expect(result.data).toEqual(new Uint8Array([50, 60, 70, 80]));
    expect(result.chunkIndex).toBe(1);
    expect(result.isFinal).toBe(true);
    expect(result.plaintextLength).toBe(3);
    expect(result.ciphertextLength).toBe(4);
    expect(result.nonce).toBe('nonce-1');
    expect(result.aadHash).toBe('aad-1');
  });

  it('rejects chunk index out of range', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ ref_count: 1, accessible_ref_count: 1 }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            chunk_count: 2,
            chunk_boundaries: [
              { offset: 0, length: 4, plaintextLength: 3 },
              { offset: 4, length: 4, plaintextLength: 3 }
            ]
          }
        ]
      });

    await expect(
      getBlobChunkDirect(
        { blobId: 'blob-1', chunkIndex: 5 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(readVfsBlobDataMock).not.toHaveBeenCalled();
  });

  it('rejects negative chunk index', async () => {
    await expect(
      getBlobChunkDirect(
        { blobId: 'blob-1', chunkIndex: -1 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns NotFound when manifest does not exist', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ ref_count: 1, accessible_ref_count: 1 }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      getBlobManifestDirect(
        { blobId: 'blob-missing' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns NotFound when blob has no refs at all', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ ref_count: 0, accessible_ref_count: 0 }]
    });

    await expect(
      getBlobManifestDirect(
        { blobId: 'blob-orphan' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('marks first chunk as non-final in multi-chunk blob', async () => {
    const blobBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);

    queryMock
      .mockResolvedValueOnce({
        rows: [{ ref_count: 1, accessible_ref_count: 1 }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            chunk_count: 2,
            chunk_boundaries: [
              { offset: 0, length: 3, plaintextLength: 2 },
              { offset: 3, length: 3, plaintextLength: 2 }
            ]
          }
        ]
      });

    readVfsBlobDataMock.mockResolvedValueOnce({ data: blobBytes });

    const result = await getBlobChunkDirect(
      { blobId: 'blob-1', chunkIndex: 0 },
      { requestHeader: new Headers() }
    );

    expect(result.isFinal).toBe(false);
    expect(result.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.nonce).toBe('');
    expect(result.aadHash).toBe('');
  });
});
