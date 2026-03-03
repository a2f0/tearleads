import { Code, ConnectError } from '@connectrpc/connect';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { persistVfsBlobData } from '../../lib/vfsBlobStore.js';
import {
  isPostgresErrorWithCode,
  normalizeRequiredString,
  parseBlobChunkBody,
  parseBlobStageBody,
  toIsoFromDateOrString
} from '../../routes/vfs/blob-shared.js';
import { upsertBlobUploadChunk } from '../../routes/vfs/blobUploadSessions.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { encoded, parseJsonBody } from './vfsDirectJson.js';

type JsonRequest = { json: string };
export type StagingIdJsonRequest = { stagingId: string; json: string };

interface BlobRegistryTypeRow {
  object_type: string;
}

interface BlobStageRow {
  id: string;
  blob_id: string;
  status: string;
  staged_at: Date | string;
  expires_at: Date | string;
}

interface BlobStagingRow {
  staged_by: string | null;
  status: string;
  expires_at: string | null;
}

function parseBase64Data(dataBase64: string): Buffer | null {
  const normalized = dataBase64.replace(/\s+/g, '');
  if (normalized.length === 0) {
    return null;
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    return null;
  }

  if (
    decoded.toString('base64').replace(/=+$/u, '') !==
    normalized.replace(/=+$/u, '')
  ) {
    return null;
  }

  return decoded;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

function requireStagingId(value: string): string {
  const stagingId = normalizeRequiredString(value);
  if (!stagingId) {
    throw new ConnectError('stagingId is required', Code.InvalidArgument);
  }

  return stagingId;
}

export async function stageBlobDirect(
  request: JsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsClaims(
    '/vfs/blobs/stage',
    context.requestHeader
  );

  const parsedBody = parseBlobStageBody(parseJsonBody(request.json));
  if (!parsedBody) {
    throw new ConnectError(
      'blobId and expiresAt are required',
      Code.InvalidArgument
    );
  }

  if (Date.parse(parsedBody.expiresAt) <= Date.now()) {
    throw new ConnectError(
      'expiresAt must be in the future',
      Code.InvalidArgument
    );
  }

  let decodedBlobData: Buffer | null = null;
  if (parsedBody.dataBase64) {
    decodedBlobData = parseBase64Data(parsedBody.dataBase64);
    if (!decodedBlobData) {
      throw new ConnectError(
        'dataBase64 must be valid base64',
        Code.InvalidArgument
      );
    }
  }

  if (decodedBlobData) {
    try {
      await persistVfsBlobData({
        blobId: parsedBody.blobId,
        data: decodedBlobData,
        ...(parsedBody.contentType
          ? { contentType: parsedBody.contentType }
          : {})
      });
    } catch (error) {
      console.error('Failed to persist blob data for VFS stage:', error);
      throw new ConnectError('Failed to persist blob data', Code.Internal);
    }
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    await client.query(
      `
      INSERT INTO vfs_registry (
        id,
        object_type,
        owner_id,
        created_at
      ) VALUES (
        $1::text,
        'file',
        $2::text,
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [parsedBody.blobId, claims.sub]
    );

    const blobRegistryResult = await client.query<BlobRegistryTypeRow>(
      `
      SELECT object_type
      FROM vfs_registry
      WHERE id = $1::text
      LIMIT 1
      FOR UPDATE
      `,
      [parsedBody.blobId]
    );
    const blobRegistryRow = blobRegistryResult.rows[0];
    if (!blobRegistryRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Blob object not found', Code.NotFound);
    }

    if (blobRegistryRow.object_type !== 'file') {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob object id conflicts with existing VFS object',
        Code.AlreadyExists
      );
    }

    await client.query(
      `
      INSERT INTO vfs_registry (
        id,
        object_type,
        owner_id,
        created_at
      ) VALUES (
        $1::text,
        'blobStage',
        $2::text,
        NOW()
      )
      `,
      [parsedBody.stagingId, claims.sub]
    );

    const result = await client.query<BlobStageRow>(
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
        $1::text,
        $2::text,
        'blob-stage:staged',
        jsonb_build_object(
          'status',
          'staged',
          'expiresAt',
          $3::timestamptz
        )::json,
        NOW()
      )
      RETURNING
        id,
        child_id AS blob_id,
        'staged'::text AS status,
        created_at AS staged_at,
        $3::timestamptz AS expires_at
      `,
      [parsedBody.stagingId, parsedBody.blobId, parsedBody.expiresAt]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Failed to stage blob', Code.Internal);
    }

    await client.query('COMMIT');
    inTransaction = false;

    return {
      json: JSON.stringify({
        stagingId: row.id,
        blobId: row.blob_id,
        status: row.status,
        stagedAt: toIsoFromDateOrString(row.staged_at),
        expiresAt: toIsoFromDateOrString(row.expires_at)
      })
    };
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    if (error instanceof ConnectError) {
      throw error;
    }

    if (isPostgresErrorWithCode(error, '23503')) {
      throw new ConnectError('Blob object not found', Code.NotFound);
    }

    if (isPostgresErrorWithCode(error, '23505')) {
      throw new ConnectError('Blob staging already exists', Code.AlreadyExists);
    }

    console.error('Failed to stage blob for VFS attach:', error);
    throw new ConnectError('Failed to stage blob', Code.Internal);
  } finally {
    client.release();
  }
}

export async function uploadBlobChunkDirect(
  request: StagingIdJsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const stagingId = requireStagingId(request.stagingId);
  const claims = await requireVfsClaims(
    `/vfs/blobs/stage/${encoded(stagingId)}/chunks`,
    context.requestHeader
  );

  const payload = parseBlobChunkBody(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError('chunk payload is invalid', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    const stagedResult = await pool.query<BlobStagingRow>(
      `
      SELECT
        stage_registry.owner_id AS staged_by,
        stage_link.visible_children::jsonb->>'expiresAt' AS expires_at,
        CASE stage_link.wrapped_session_key
          WHEN 'blob-stage:staged' THEN 'staged'
          WHEN 'blob-stage:attached' THEN 'attached'
          WHEN 'blob-stage:abandoned' THEN 'abandoned'
          ELSE 'invalid'
        END AS status
      FROM vfs_registry AS stage_registry
      INNER JOIN vfs_links AS stage_link
        ON stage_link.id = stage_registry.id
       AND stage_link.parent_id = stage_registry.id
      WHERE stage_registry.id = $1::text
        AND stage_registry.object_type = 'blobStage'
      LIMIT 1
      `,
      [stagingId]
    );

    const stagedRow = stagedResult.rows[0];
    if (!stagedRow) {
      throw new ConnectError('Blob staging not found', Code.NotFound);
    }

    if (stagedRow.staged_by !== claims.sub) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    if (stagedRow.status !== 'staged') {
      throw new ConnectError(
        'Blob staging is no longer uploadable',
        Code.AlreadyExists
      );
    }

    await upsertBlobUploadChunk({
      stagingId,
      uploadId: payload.uploadId,
      expiresAt: stagedRow.expires_at,
      chunk: {
        chunkIndex: payload.chunkIndex,
        isFinal: payload.isFinal,
        ciphertextBase64: payload.ciphertextBase64,
        plaintextLength: payload.plaintextLength,
        ciphertextLength: payload.ciphertextLength
      }
    });

    return {
      json: JSON.stringify({
        accepted: true,
        stagingId,
        uploadId: payload.uploadId,
        chunkIndex: payload.chunkIndex
      })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to upload staged blob chunk:', error);
    throw new ConnectError('Failed to upload staged blob chunk', Code.Internal);
  }
}
