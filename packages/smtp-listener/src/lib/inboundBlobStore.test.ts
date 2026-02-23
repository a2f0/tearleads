import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sendMock, s3CtorMock, putObjectCtorMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({})),
  s3CtorMock: vi.fn(),
  putObjectCtorMock: vi.fn()
}));

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
      putObjectCtorMock(input);
    }
  }

  class S3Client {
    config: unknown;

    constructor(config: unknown) {
      this.config = config;
      s3CtorMock(config);
    }

    async send(command: unknown): Promise<unknown> {
      return sendMock(command);
    }
  }

  return {
    PutObjectCommand,
    S3Client
  };
});

function clearBlobEnv(): void {
  delete process.env['VFS_BLOB_STORE_PROVIDER'];
  delete process.env['VFS_BLOB_S3_BUCKET'];
  delete process.env['VFS_BLOB_S3_KEY_PREFIX'];
  delete process.env['VFS_BLOB_S3_ENDPOINT'];
  delete process.env['VFS_BLOB_S3_REGION'];
  delete process.env['VFS_BLOB_S3_ACCESS_KEY_ID'];
  delete process.env['VFS_BLOB_S3_SECRET_ACCESS_KEY'];
  delete process.env['VFS_BLOB_S3_FORCE_PATH_STYLE'];
  delete process.env['AWS_REGION'];
}

describe('S3InboundBlobStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    clearBlobEnv();
  });

  it('throws when required bucket env is missing', async () => {
    process.env['VFS_BLOB_STORE_PROVIDER'] = 's3';
    const { S3InboundBlobStore } = await import('./inboundBlobStore.js');

    await expect(
      new S3InboundBlobStore().putEncryptedMessage({
        messageId: 'msg-1',
        ciphertext: new Uint8Array([1, 2, 3]),
        contentType: 'message/rfc822'
      })
    ).rejects.toThrow('Missing required environment variable: VFS_BLOB_S3_BUCKET');
  });

  it('throws for unsupported blob provider', async () => {
    process.env['VFS_BLOB_STORE_PROVIDER'] = 'garage';
    process.env['VFS_BLOB_S3_BUCKET'] = 'bucket-a';
    const { S3InboundBlobStore } = await import('./inboundBlobStore.js');

    await expect(
      new S3InboundBlobStore().putEncryptedMessage({
        messageId: 'msg-2',
        ciphertext: new Uint8Array([9]),
        contentType: 'message/rfc822'
      })
    ).rejects.toThrow('Unsupported VFS_BLOB_STORE_PROVIDER "garage". Expected "s3".');
  });

  it('stores encrypted message with trimmed prefix and explicit credentials', async () => {
    process.env['VFS_BLOB_S3_BUCKET'] = 'bucket-a';
    process.env['VFS_BLOB_S3_KEY_PREFIX'] = ' ingest-root/// ';
    process.env['VFS_BLOB_S3_REGION'] = 'us-west-2';
    process.env['VFS_BLOB_S3_ACCESS_KEY_ID'] = 'access';
    process.env['VFS_BLOB_S3_SECRET_ACCESS_KEY'] = 'secret';
    process.env['VFS_BLOB_S3_FORCE_PATH_STYLE'] = '0';
    const { S3InboundBlobStore } = await import('./inboundBlobStore.js');

    const ciphertext = new TextEncoder().encode('hello-world');
    const result = await new S3InboundBlobStore().putEncryptedMessage({
      messageId: 'msg-3',
      ciphertext,
      contentType: 'message/rfc822'
    });

    expect(s3CtorMock).toHaveBeenCalledOnce();
    expect(s3CtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'us-west-2',
        forcePathStyle: false,
        credentials: {
          accessKeyId: 'access',
          secretAccessKey: 'secret'
        }
      })
    );
    expect(putObjectCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'bucket-a',
        Key: 'ingest-root/smtp/inbound/msg-3.bin',
        Body: ciphertext,
        ContentType: 'message/rfc822'
      })
    );
    expect(sendMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      storageKey: 'ingest-root/smtp/inbound/msg-3.bin',
      sha256: 'afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d',
      ciphertextSize: ciphertext.byteLength
    });
  });

  it('reuses runtime for same env and rebuilds when config changes', async () => {
    process.env['VFS_BLOB_S3_BUCKET'] = 'bucket-a';
    process.env['VFS_BLOB_S3_ENDPOINT'] = 'http://localhost:9000';
    process.env['VFS_BLOB_S3_FORCE_PATH_STYLE'] = 'not-a-bool';
    const { S3InboundBlobStore } = await import('./inboundBlobStore.js');

    const store = new S3InboundBlobStore();
    await store.putEncryptedMessage({
      messageId: 'msg-4',
      ciphertext: new Uint8Array([4]),
      contentType: 'message/rfc822'
    });
    await store.putEncryptedMessage({
      messageId: 'msg-5',
      ciphertext: new Uint8Array([5]),
      contentType: 'message/rfc822'
    });

    expect(s3CtorMock).toHaveBeenCalledTimes(2);
    expect(s3CtorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        region: 'us-east-1'
      })
    );

    process.env['AWS_REGION'] = 'eu-central-1';
    delete process.env['VFS_BLOB_S3_REGION'];

    await store.putEncryptedMessage({
      messageId: 'msg-6',
      ciphertext: new Uint8Array([6]),
      contentType: 'message/rfc822'
    });

    expect(s3CtorMock).toHaveBeenCalledTimes(3);
    expect(s3CtorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        region: 'eu-central-1'
      })
    );
  });

  it('supports explicit true forcePathStyle and default fallback parsing', async () => {
    process.env['VFS_BLOB_S3_BUCKET'] = 'bucket-b';
    process.env['VFS_BLOB_S3_FORCE_PATH_STYLE'] = 'true';
    const { S3InboundBlobStore } = await import('./inboundBlobStore.js');

    await new S3InboundBlobStore().putEncryptedMessage({
      messageId: 'msg-7',
      ciphertext: new Uint8Array([7]),
      contentType: 'message/rfc822'
    });

    expect(s3CtorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        forcePathStyle: true
      })
    );

    delete process.env['VFS_BLOB_S3_FORCE_PATH_STYLE'];
    await new S3InboundBlobStore().putEncryptedMessage({
      messageId: 'msg-8',
      ciphertext: new Uint8Array([8]),
      contentType: 'message/rfc822'
    });

    expect(s3CtorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        forcePathStyle: false
      })
    );
  });
});
