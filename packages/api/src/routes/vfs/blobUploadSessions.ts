import { getRedisClient } from '@tearleads/shared/redis';

interface UploadedChunk {
  chunkIndex: number;
  isFinal: boolean;
  ciphertextBase64: string;
  plaintextLength: number;
  ciphertextLength: number;
}

const BLOB_UPLOAD_CHUNK_KEY_PREFIX = 'vfs:blobUpload';
const BLOB_UPLOAD_INDEX_KEY_PREFIX = 'vfs:blobUploadIndex';
const BLOB_UPLOAD_STAGE_UPLOADS_KEY_PREFIX = 'vfs:blobUploadStageUploads';
const BLOB_UPLOAD_STAGES_KEY = 'vfs:blobUploadStages';
const DEFAULT_BLOB_UPLOAD_SESSION_MAX_TTL_SECONDS = 24 * 60 * 60;

function toChunkKey(input: {
  stagingId: string;
  uploadId: string;
  chunkIndex: number;
}): string {
  return `${BLOB_UPLOAD_CHUNK_KEY_PREFIX}:${input.stagingId}:${input.uploadId}:${String(input.chunkIndex)}`;
}

function toUploadIndexKey(input: {
  stagingId: string;
  uploadId: string;
}): string {
  return `${BLOB_UPLOAD_INDEX_KEY_PREFIX}:${input.stagingId}:${input.uploadId}`;
}

function toStageUploadsKey(stagingId: string): string {
  return `${BLOB_UPLOAD_STAGE_UPLOADS_KEY_PREFIX}:${stagingId}`;
}

function parseMaxTtlSeconds(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_BLOB_UPLOAD_SESSION_MAX_TTL_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_BLOB_UPLOAD_SESSION_MAX_TTL_SECONDS;
  }

  return parsed;
}

function computeBlobUploadSessionTtlSeconds(
  expiresAt: string | null,
  maxTtlSeconds: number
): number {
  if (!expiresAt) {
    return maxTtlSeconds;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return maxTtlSeconds;
  }

  const ttlFromExpiry = Math.floor((expiresAtMs - Date.now()) / 1000);
  const boundedTtl = Math.min(maxTtlSeconds, ttlFromExpiry);
  return Math.max(1, boundedTtl);
}

function parseUploadedChunk(value: unknown): UploadedChunk | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value;
  const chunkIndex = Object.hasOwn(candidate, 'chunkIndex')
    ? Reflect.get(candidate, 'chunkIndex')
    : undefined;
  const isFinal = Object.hasOwn(candidate, 'isFinal')
    ? Reflect.get(candidate, 'isFinal')
    : undefined;
  const ciphertextBase64 = Object.hasOwn(candidate, 'ciphertextBase64')
    ? Reflect.get(candidate, 'ciphertextBase64')
    : undefined;
  const plaintextLength = Object.hasOwn(candidate, 'plaintextLength')
    ? Reflect.get(candidate, 'plaintextLength')
    : undefined;
  const ciphertextLength = Object.hasOwn(candidate, 'ciphertextLength')
    ? Reflect.get(candidate, 'ciphertextLength')
    : undefined;

  if (
    typeof chunkIndex !== 'number' ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    typeof isFinal !== 'boolean' ||
    typeof ciphertextBase64 !== 'string' ||
    ciphertextBase64.length === 0 ||
    typeof plaintextLength !== 'number' ||
    !Number.isInteger(plaintextLength) ||
    plaintextLength < 0 ||
    typeof ciphertextLength !== 'number' ||
    !Number.isInteger(ciphertextLength) ||
    ciphertextLength < 0
  ) {
    return null;
  }

  return {
    chunkIndex,
    isFinal,
    ciphertextBase64,
    plaintextLength,
    ciphertextLength
  };
}

function parseChunkIndex(rawValue: string): number | null {
  if (!/^[0-9]+$/u.test(rawValue)) {
    return null;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

async function readSortedChunkIndexes(input: {
  stagingId: string;
  uploadId: string;
}): Promise<number[] | null> {
  const client = await getRedisClient();
  const rawIndexes = await client.sMembers(toUploadIndexKey(input));
  if (!Array.isArray(rawIndexes) || rawIndexes.length === 0) {
    return null;
  }

  const parsedIndexes: number[] = [];
  for (const rawIndex of rawIndexes) {
    const parsedIndex = parseChunkIndex(rawIndex);
    if (parsedIndex === null) {
      return null;
    }
    parsedIndexes.push(parsedIndex);
  }

  parsedIndexes.sort((left, right) => left - right);
  return parsedIndexes;
}

async function deleteBlobUploadSessionWithClient(input: {
  stagingId: string;
  uploadId: string;
}): Promise<void> {
  const client = await getRedisClient();
  const chunkIndexes = await readSortedChunkIndexes({
    stagingId: input.stagingId,
    uploadId: input.uploadId
  });

  if (chunkIndexes) {
    for (const chunkIndex of chunkIndexes) {
      await client.del(
        toChunkKey({
          stagingId: input.stagingId,
          uploadId: input.uploadId,
          chunkIndex
        })
      );
    }
  }

  await client.del(
    toUploadIndexKey({
      stagingId: input.stagingId,
      uploadId: input.uploadId
    })
  );

  const stageUploadsKey = toStageUploadsKey(input.stagingId);
  await client.sRem(stageUploadsKey, input.uploadId);

  const remainingUploads = await client.sMembers(stageUploadsKey);
  if (!Array.isArray(remainingUploads) || remainingUploads.length === 0) {
    await client.del(stageUploadsKey);
    await client.sRem(BLOB_UPLOAD_STAGES_KEY, input.stagingId);
  }
}

export async function upsertBlobUploadChunk(input: {
  stagingId: string;
  uploadId: string;
  expiresAt: string | null;
  chunk: UploadedChunk;
}): Promise<void> {
  const maxTtlSeconds = parseMaxTtlSeconds(
    process.env['VFS_BLOB_UPLOAD_SESSION_MAX_TTL_SECONDS']
  );
  const ttlSeconds = computeBlobUploadSessionTtlSeconds(
    input.expiresAt,
    maxTtlSeconds
  );
  const client = await getRedisClient();
  const chunkKey = toChunkKey({
    stagingId: input.stagingId,
    uploadId: input.uploadId,
    chunkIndex: input.chunk.chunkIndex
  });

  await client.set(chunkKey, JSON.stringify(input.chunk), {
    EX: ttlSeconds
  });
  await client.sAdd(
    toUploadIndexKey({ stagingId: input.stagingId, uploadId: input.uploadId }),
    String(input.chunk.chunkIndex)
  );
  await client.expire(
    toUploadIndexKey({ stagingId: input.stagingId, uploadId: input.uploadId }),
    ttlSeconds
  );

  const stageUploadsKey = toStageUploadsKey(input.stagingId);
  await client.sAdd(stageUploadsKey, input.uploadId);
  await client.expire(stageUploadsKey, ttlSeconds);

  await client.sAdd(BLOB_UPLOAD_STAGES_KEY, input.stagingId);
  await client.expire(BLOB_UPLOAD_STAGES_KEY, maxTtlSeconds);
}

export async function getBlobUploadChunks(input: {
  stagingId: string;
  uploadId: string;
}): Promise<UploadedChunk[] | null> {
  const chunkIndexes = await readSortedChunkIndexes({
    stagingId: input.stagingId,
    uploadId: input.uploadId
  });
  if (!chunkIndexes || chunkIndexes.length === 0) {
    return null;
  }

  const client = await getRedisClient();
  const chunks: UploadedChunk[] = [];

  for (const chunkIndex of chunkIndexes) {
    const rawChunk = await client.get(
      toChunkKey({
        stagingId: input.stagingId,
        uploadId: input.uploadId,
        chunkIndex
      })
    );

    if (!rawChunk) {
      return null;
    }

    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(rawChunk);
    } catch {
      return null;
    }

    const parsedChunk = parseUploadedChunk(parsedValue);
    if (!parsedChunk || parsedChunk.chunkIndex !== chunkIndex) {
      return null;
    }

    chunks.push(parsedChunk);
  }

  return chunks;
}

export async function deleteBlobUploadSession(input: {
  stagingId: string;
  uploadId: string;
}): Promise<void> {
  await deleteBlobUploadSessionWithClient(input);
}

async function deleteBlobUploadSessionsForStagingWithClient(
  stagingId: string
): Promise<void> {
  const client = await getRedisClient();
  const uploadIds = await client.sMembers(toStageUploadsKey(stagingId));

  if (Array.isArray(uploadIds)) {
    for (const uploadId of uploadIds) {
      await deleteBlobUploadSessionWithClient({
        stagingId,
        uploadId
      });
    }
  }

  await client.del(toStageUploadsKey(stagingId));
  await client.sRem(BLOB_UPLOAD_STAGES_KEY, stagingId);
}

export async function clearBlobUploadSessions(): Promise<void> {
  const client = await getRedisClient();
  const stagingIds = await client.sMembers(BLOB_UPLOAD_STAGES_KEY);

  if (Array.isArray(stagingIds)) {
    for (const stagingId of stagingIds) {
      await deleteBlobUploadSessionsForStagingWithClient(stagingId);
    }
  }

  await client.del(BLOB_UPLOAD_STAGES_KEY);
}

export async function deleteBlobUploadSessionsForStaging(input: {
  stagingId: string;
}): Promise<void> {
  await deleteBlobUploadSessionsForStagingWithClient(input.stagingId);
}
