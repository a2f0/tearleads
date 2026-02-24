import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type {
  EncryptedBlobWriteResult,
  InboundBlobStore
} from '../types/inboundContracts.js';

interface BlobRuntime {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
}

let runtime: BlobRuntime | null = null;
let runtimeKey: string | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function parseBool(value: string | null, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return defaultValue;
}

function buildRuntime(): { runtime: BlobRuntime; key: string } {
  const provider =
    getOptionalEnv('VFS_BLOB_STORE_PROVIDER')?.toLowerCase() ?? 's3';
  if (provider !== 's3') {
    throw new Error(
      `Unsupported VFS_BLOB_STORE_PROVIDER "${provider}". Expected "s3".`
    );
  }

  const bucket = getRequiredEnv('VFS_BLOB_S3_BUCKET');
  const keyPrefix = getOptionalEnv('VFS_BLOB_S3_KEY_PREFIX') ?? '';
  const endpoint = getOptionalEnv('VFS_BLOB_S3_ENDPOINT');
  const region =
    getOptionalEnv('VFS_BLOB_S3_REGION') ??
    process.env['AWS_REGION'] ??
    'us-east-1';
  const accessKeyId = getOptionalEnv('VFS_BLOB_S3_ACCESS_KEY_ID');
  const secretAccessKey = getOptionalEnv('VFS_BLOB_S3_SECRET_ACCESS_KEY');
  const forcePathStyle = parseBool(
    getOptionalEnv('VFS_BLOB_S3_FORCE_PATH_STYLE'),
    endpoint !== null
  );

  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(accessKeyId && secretAccessKey
      ? {
          credentials: {
            accessKeyId,
            secretAccessKey
          }
        }
      : {}),
    forcePathStyle
  });

  return {
    runtime: {
      client,
      bucket,
      keyPrefix
    },
    key: JSON.stringify({
      provider,
      bucket,
      keyPrefix,
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      forcePathStyle
    })
  };
}

function getRuntime(): BlobRuntime {
  const built = buildRuntime();
  if (runtime && runtimeKey === built.key) {
    return runtime;
  }
  runtime = built.runtime;
  runtimeKey = built.key;
  return runtime;
}

function toStorageKey(messageId: string, prefix: string): string {
  const leaf = `smtp/inbound/${messageId}.bin`;
  if (prefix.length === 0) {
    return leaf;
  }
  return `${prefix.replace(/\/+$/u, '')}/${leaf}`;
}

export class S3InboundBlobStore implements InboundBlobStore {
  async putEncryptedMessage(input: {
    messageId: string;
    ciphertext: Uint8Array;
    contentType: string;
  }): Promise<EncryptedBlobWriteResult> {
    const current = getRuntime();
    const storageKey = toStorageKey(input.messageId, current.keyPrefix);
    const sha256 = createHash('sha256').update(input.ciphertext).digest('hex');

    await current.client.send(
      new PutObjectCommand({
        Bucket: current.bucket,
        Key: storageKey,
        Body: input.ciphertext,
        ContentType: input.contentType
      })
    );

    return {
      storageKey,
      sha256,
      ciphertextSize: input.ciphertext.byteLength
    };
  }
}
