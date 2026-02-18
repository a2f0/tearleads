import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

interface S3BlobStoreConfig {
  bucket: string;
  keyPrefix: string;
}

interface BlobStoreRuntime {
  client: S3Client;
  config: S3BlobStoreConfig;
}

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
let runtime: BlobStoreRuntime | null = null;
let runtimeKey: string | null = null;

function normalizeRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required blob storage environment variable: ${name}`
    );
  }
  return value.trim();
}

function normalizeOptionalEnv(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function parseBooleanEnv(value: string | null, defaultValue: boolean): boolean {
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

function getS3BlobStoreConfig(): S3BlobStoreConfig {
  const bucket = normalizeRequiredEnv('VFS_BLOB_S3_BUCKET');
  const keyPrefix = normalizeOptionalEnv('VFS_BLOB_S3_KEY_PREFIX') ?? '';
  return { bucket, keyPrefix };
}

function createS3Client(): S3Client {
  const endpoint = normalizeOptionalEnv('VFS_BLOB_S3_ENDPOINT');
  const region =
    normalizeOptionalEnv('VFS_BLOB_S3_REGION') ??
    process.env['AWS_REGION'] ??
    'us-east-1';
  const accessKeyId = normalizeOptionalEnv('VFS_BLOB_S3_ACCESS_KEY_ID');
  const secretAccessKey = normalizeOptionalEnv('VFS_BLOB_S3_SECRET_ACCESS_KEY');
  const forcePathStyle = parseBooleanEnv(
    normalizeOptionalEnv('VFS_BLOB_S3_FORCE_PATH_STYLE'),
    endpoint !== null
  );

  return new S3Client({
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
}

function getRuntime(): BlobStoreRuntime {
  const provider =
    normalizeOptionalEnv('VFS_BLOB_STORE_PROVIDER')?.toLowerCase() ?? 's3';
  if (provider !== 's3') {
    throw new Error(
      `Unsupported VFS_BLOB_STORE_PROVIDER "${provider}". Expected "s3".`
    );
  }

  const config = getS3BlobStoreConfig();
  const cacheKey = JSON.stringify({
    provider,
    bucket: config.bucket,
    keyPrefix: config.keyPrefix,
    endpoint: normalizeOptionalEnv('VFS_BLOB_S3_ENDPOINT'),
    region:
      normalizeOptionalEnv('VFS_BLOB_S3_REGION') ??
      process.env['AWS_REGION'] ??
      'us-east-1',
    accessKeyId: normalizeOptionalEnv('VFS_BLOB_S3_ACCESS_KEY_ID'),
    secretAccessKey: normalizeOptionalEnv('VFS_BLOB_S3_SECRET_ACCESS_KEY'),
    forcePathStyle: parseBooleanEnv(
      normalizeOptionalEnv('VFS_BLOB_S3_FORCE_PATH_STYLE'),
      normalizeOptionalEnv('VFS_BLOB_S3_ENDPOINT') !== null
    )
  });

  if (runtime && runtimeKey === cacheKey) {
    return runtime;
  }

  runtime = {
    client: createS3Client(),
    config
  };
  runtimeKey = cacheKey;
  return runtime;
}

function toStorageKey(blobId: string, keyPrefix: string): string {
  if (keyPrefix.length === 0) {
    return blobId;
  }
  const normalizedPrefix = keyPrefix.endsWith('/')
    ? keyPrefix.slice(0, -1)
    : keyPrefix;
  return `${normalizedPrefix}/${blobId}`;
}

export async function persistVfsBlobData(params: {
  blobId: string;
  data: Uint8Array;
  contentType?: string;
}): Promise<{ bucket: string; storageKey: string }> {
  const { client, config } = getRuntime();
  const storageKey = toStorageKey(params.blobId, config.keyPrefix);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
      Body: params.data,
      ContentType: params.contentType ?? DEFAULT_CONTENT_TYPE
    })
  );

  return {
    bucket: config.bucket,
    storageKey
  };
}

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (typeof chunk === 'string') {
    return new TextEncoder().encode(chunk);
  }
  return new Uint8Array(0);
}

export async function readVfsBlobData(params: {
  blobId: string;
}): Promise<{ data: Uint8Array; contentType: string | null }> {
  const { client, config } = getRuntime();
  const storageKey = toStorageKey(params.blobId, config.keyPrefix);
  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: storageKey
    })
  );

  const body = result.Body;
  if (!body) {
    return {
      data: new Uint8Array(0),
      contentType: result.ContentType ?? null
    };
  }

  const bodyWithTransform = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof bodyWithTransform.transformToByteArray === 'function') {
    return {
      data: await bodyWithTransform.transformToByteArray(),
      contentType: result.ContentType ?? null
    };
  }

  if (
    typeof (body as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] !== 'function'
  ) {
    return {
      data: new Uint8Array(0),
      contentType: result.ContentType ?? null
    };
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<unknown>) {
    chunks.push(toUint8Array(chunk));
  }

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    data: merged,
    contentType: result.ContentType ?? null
  };
}

export async function deleteVfsBlobData(params: {
  blobId: string;
}): Promise<void> {
  const { client, config } = getRuntime();
  const storageKey = toStorageKey(params.blobId, config.keyPrefix);

  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: storageKey
    })
  );
}
