import { getPostgresPool } from '../../lib/postgres.js';

export interface UploadedChunk {
  chunkIndex: number;
  isFinal: boolean;
  ciphertextBase64: string;
  plaintextLength: number;
  ciphertextLength: number;
}

interface BlobUploadChunkRow {
  visible_children: unknown;
}

function toChunkRowId(input: {
  stagingId: string;
  uploadId: string;
  chunkIndex: number;
}): string {
  return `blob-chunk:${input.stagingId}:${input.uploadId}:${String(input.chunkIndex)}`;
}

function toChunkWrappedSessionKey(input: {
  uploadId: string;
  chunkIndex: number;
}): string {
  return `blob-upload-chunk:${input.uploadId}:${String(input.chunkIndex)}`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
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

export async function upsertBlobUploadChunk(input: {
  stagingId: string;
  uploadId: string;
  chunk: UploadedChunk;
}): Promise<void> {
  const pool = await getPostgresPool();
  const rowId = toChunkRowId({
    stagingId: input.stagingId,
    uploadId: input.uploadId,
    chunkIndex: input.chunk.chunkIndex
  });
  const wrappedSessionKey = toChunkWrappedSessionKey({
    uploadId: input.uploadId,
    chunkIndex: input.chunk.chunkIndex
  });

  await pool.query(
    `
    INSERT INTO vfs_links (
      id,
      parent_id,
      child_id,
      wrapped_session_key,
      visible_children,
      created_at
    ) VALUES (
      $1::text,
      $2::text,
      $2::text,
      $3::text,
      $4::json,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET visible_children = EXCLUDED.visible_children
    `,
    [rowId, input.stagingId, wrappedSessionKey, JSON.stringify(input.chunk)]
  );
}

export async function getBlobUploadChunks(input: {
  stagingId: string;
  uploadId: string;
}): Promise<UploadedChunk[] | null> {
  const pool = await getPostgresPool();
  const uploadIdPattern = escapeLikePattern(input.uploadId);
  const result = await pool.query<BlobUploadChunkRow>(
    `
    SELECT visible_children
    FROM vfs_links
    WHERE parent_id = $1::text
      AND wrapped_session_key LIKE $2::text ESCAPE '\\'
    ORDER BY (visible_children::jsonb->>'chunkIndex')::int ASC
    `,
    [input.stagingId, `blob-upload-chunk:${uploadIdPattern}:%`]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const parsedChunks: UploadedChunk[] = [];
  for (const row of result.rows) {
    const parsed = parseUploadedChunk(row.visible_children);
    if (!parsed) {
      return null;
    }
    parsedChunks.push(parsed);
  }

  return parsedChunks;
}

export async function deleteBlobUploadSession(input: {
  stagingId: string;
  uploadId: string;
}): Promise<void> {
  const pool = await getPostgresPool();
  const uploadIdPattern = escapeLikePattern(input.uploadId);
  await pool.query(
    `
    DELETE FROM vfs_links
    WHERE parent_id = $1::text
      AND wrapped_session_key LIKE $2::text ESCAPE '\\'
    `,
    [input.stagingId, `blob-upload-chunk:${uploadIdPattern}:%`]
  );
}

export async function clearBlobUploadSessions(): Promise<void> {
  const pool = await getPostgresPool();
  await pool.query(
    `
    DELETE FROM vfs_links
    WHERE wrapped_session_key LIKE 'blob-upload-chunk:%'
    `
  );
}

export async function deleteBlobUploadSessionsForStaging(input: {
  stagingId: string;
}): Promise<void> {
  const pool = await getPostgresPool();
  await pool.query(
    `
    DELETE FROM vfs_links
    WHERE parent_id = $1::text
      AND wrapped_session_key LIKE 'blob-upload-chunk:%'
    `,
    [input.stagingId]
  );
}
