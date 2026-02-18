import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();
const mockPutObjectCommand = vi.fn(function MockPutObjectCommand(
  input: unknown
) {
  return { input };
});
const mockGetObjectCommand = vi.fn(function MockGetObjectCommand(
  input: unknown
) {
  return { input };
});
const mockDeleteObjectCommand = vi.fn(function MockDeleteObjectCommand(
  input: unknown
) {
  return { input };
});
const mockS3ClientConstructor = vi.fn(function MockS3Client() {
  return {
    send: mockSend
  };
});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: mockS3ClientConstructor,
  PutObjectCommand: mockPutObjectCommand,
  GetObjectCommand: mockGetObjectCommand,
  DeleteObjectCommand: mockDeleteObjectCommand
}));

describe('vfsBlobStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mockSend.mockReset();
    mockPutObjectCommand.mockClear();
    mockGetObjectCommand.mockClear();
    mockDeleteObjectCommand.mockClear();
    mockS3ClientConstructor.mockClear();
  });

  it('writes blob data to configured bucket', async () => {
    vi.stubEnv('VFS_BLOB_S3_BUCKET', 'blob-bucket');
    vi.stubEnv('VFS_BLOB_S3_KEY_PREFIX', 'tenant-a');
    mockSend.mockResolvedValueOnce({});

    const { persistVfsBlobData } = await import('./vfsBlobStore.js');
    const result = await persistVfsBlobData({
      blobId: 'blob-1',
      data: Uint8Array.from([1, 2, 3]),
      contentType: 'application/test'
    });

    expect(result).toEqual({
      bucket: 'blob-bucket',
      storageKey: 'tenant-a/blob-1'
    });
    expect(mockPutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'blob-bucket',
        Key: 'tenant-a/blob-1',
        ContentType: 'application/test'
      })
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('throws when bucket configuration is missing', async () => {
    const { persistVfsBlobData } = await import('./vfsBlobStore.js');

    await expect(
      persistVfsBlobData({
        blobId: 'blob-1',
        data: Uint8Array.from([1])
      })
    ).rejects.toThrow('VFS_BLOB_S3_BUCKET');
  });

  it('reads blob data from configured bucket', async () => {
    vi.stubEnv('VFS_BLOB_S3_BUCKET', 'blob-bucket');
    mockSend.mockResolvedValueOnce({
      Body: (async function* chunks() {
        yield Uint8Array.from([104, 101]);
        yield Uint8Array.from([108, 108, 111]);
      })(),
      ContentType: 'text/plain'
    });

    const { readVfsBlobData } = await import('./vfsBlobStore.js');
    const result = await readVfsBlobData({ blobId: 'blob-1' });

    expect(Buffer.from(result.data).toString('utf8')).toBe('hello');
    expect(result.contentType).toBe('text/plain');
    expect(mockGetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'blob-bucket',
        Key: 'blob-1'
      })
    );
  });

  it('reads blob data via transformToByteArray when available', async () => {
    vi.stubEnv('VFS_BLOB_S3_BUCKET', 'blob-bucket');
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => Uint8Array.from([104, 105])
      },
      ContentType: 'text/plain'
    });

    const { readVfsBlobData } = await import('./vfsBlobStore.js');
    const result = await readVfsBlobData({ blobId: 'blob-1' });

    expect(Buffer.from(result.data).toString('utf8')).toBe('hi');
    expect(result.contentType).toBe('text/plain');
  });

  it('returns empty payload when body is missing', async () => {
    vi.stubEnv('VFS_BLOB_S3_BUCKET', 'blob-bucket');
    mockSend.mockResolvedValueOnce({
      Body: null,
      ContentType: 'application/octet-stream'
    });

    const { readVfsBlobData } = await import('./vfsBlobStore.js');
    const result = await readVfsBlobData({ blobId: 'blob-1' });

    expect(result.data).toEqual(new Uint8Array(0));
    expect(result.contentType).toBe('application/octet-stream');
  });

  it('returns empty payload when body is non-iterable', async () => {
    vi.stubEnv('VFS_BLOB_S3_BUCKET', 'blob-bucket');
    mockSend.mockResolvedValueOnce({
      Body: {},
      ContentType: null
    });

    const { readVfsBlobData } = await import('./vfsBlobStore.js');
    const result = await readVfsBlobData({ blobId: 'blob-1' });

    expect(result.data).toEqual(new Uint8Array(0));
    expect(result.contentType).toBeNull();
  });

  it('deletes blob data from configured bucket', async () => {
    vi.stubEnv('VFS_BLOB_S3_BUCKET', 'blob-bucket');
    mockSend.mockResolvedValueOnce({});

    const { deleteVfsBlobData } = await import('./vfsBlobStore.js');
    await deleteVfsBlobData({ blobId: 'blob-1' });

    expect(mockDeleteObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'blob-bucket',
        Key: 'blob-1'
      })
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
