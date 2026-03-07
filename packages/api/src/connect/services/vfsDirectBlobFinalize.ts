import { Code, ConnectError } from '@connectrpc/connect';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { persistVfsBlobData } from '../../lib/vfsBlobStore.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import {
  normalizeRequiredString,
  parseBlobCommitBody
} from './vfsDirectBlobShared.js';
import type { StagingIdJsonRequest } from './vfsDirectBlobStageUpload.js';
import {
  deleteBlobUploadSession,
  deleteBlobUploadSessionsForStaging,
  getBlobUploadChunks
} from './vfsDirectBlobUploadSessions.js';
import { encoded, parseJsonBody } from './vfsDirectJson.js';
export type AbandonBlobDirectResponse = {
  abandoned: boolean;
  stagingId: string;
  status: string;
};
export type CommitBlobDirectResponse = {
  committed: boolean;
  stagingId: string;
  uploadId: string;
  blobId: string;
};

interface BlobStagingStateRow {
  staged_by: string | null;
  status: string;
}

interface BlobCommitStagingRow {
  blob_id: string;
  staged_by: string | null;
  status: string;
}

function decodeBase64Strict(value: string): Uint8Array | null {
  const normalized = value.replace(/\s+/g, '');
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

export async function abandonBlobDirect(
  request: StagingIdJsonRequest,
  context: { requestHeader: Headers }
): Promise<AbandonBlobDirectResponse> {
  const stagingId = requireStagingId(request.stagingId);
  const claims = await requireVfsClaims(
    `/vfs/blobs/stage/${encoded(stagingId)}/abandon`,
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const stagedResult = await client.query<BlobStagingStateRow>(
      `
      SELECT
        stage_registry.owner_id AS staged_by,
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
      FOR UPDATE OF stage_registry, stage_link
      `,
      [stagingId]
    );

    const stagedRow = stagedResult.rows[0];
    if (!stagedRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Blob staging not found', Code.NotFound);
    }

    if (stagedRow.staged_by !== claims.sub) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    if (stagedRow.status !== 'staged') {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob staging is no longer abandonable',
        Code.AlreadyExists
      );
    }

    const abandonedAtIso = new Date().toISOString();
    const updatedResult = await client.query(
      `
      UPDATE vfs_links
      SET wrapped_session_key = 'blob-stage:abandoned',
          visible_children = jsonb_set(
            jsonb_set(
              COALESCE(vfs_links.visible_children::jsonb, '{}'::jsonb),
              '{status}',
              to_jsonb('abandoned'::text),
              true
            ),
            '{abandonedAt}',
            to_jsonb($2::text),
            true
          )::json
      WHERE id = $1::text
        AND wrapped_session_key = 'blob-stage:staged'
      `,
      [stagingId, abandonedAtIso]
    );

    if ((updatedResult.rowCount ?? 0) < 1) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob staging is no longer abandonable',
        Code.AlreadyExists
      );
    }

    await deleteBlobUploadSessionsForStaging({ stagingId });

    await client.query('COMMIT');
    inTransaction = false;

    return {
      abandoned: true,
      stagingId,
      status: 'abandoned'
    };
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to abandon staged blob:', error);
    throw new ConnectError('Failed to abandon staged blob', Code.Internal);
  } finally {
    client.release();
  }
}

export async function commitBlobDirect(
  request: StagingIdJsonRequest,
  context: { requestHeader: Headers }
): Promise<CommitBlobDirectResponse> {
  const stagingId = requireStagingId(request.stagingId);
  const claims = await requireVfsClaims(
    `/vfs/blobs/stage/${encoded(stagingId)}/commit`,
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  const payload = parseBlobCommitBody(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError('commit payload is invalid', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    const stagedResult = await pool.query<BlobCommitStagingRow>(
      `
      SELECT
        stage_link.child_id AS blob_id,
        stage_registry.owner_id AS staged_by,
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
        'Blob staging is no longer committable',
        Code.AlreadyExists
      );
    }

    const blobId = normalizeRequiredString(stagedRow.blob_id);
    if (!blobId) {
      throw new ConnectError('Failed to commit staged blob', Code.Internal);
    }

    const chunks = await getBlobUploadChunks({
      stagingId,
      uploadId: payload.uploadId
    });
    if (!chunks || chunks.length === 0) {
      throw new ConnectError(
        'No uploaded chunks found for staging',
        Code.AlreadyExists
      );
    }

    if (chunks.length !== payload.chunkCount) {
      throw new ConnectError(
        'Chunk count does not match commit payload',
        Code.AlreadyExists
      );
    }

    const decodedChunks: Uint8Array[] = [];
    let totalCiphertextBytes = 0;
    let totalPlaintextBytes = 0;

    for (const [index, chunk] of chunks.entries()) {
      if (chunk.chunkIndex !== index) {
        throw new ConnectError(
          'Chunks must be contiguous from index 0',
          Code.AlreadyExists
        );
      }

      const shouldBeFinal = index === chunks.length - 1;
      if (chunk.isFinal !== shouldBeFinal) {
        throw new ConnectError(
          'Chunk finality does not match ordering',
          Code.AlreadyExists
        );
      }

      const decoded = decodeBase64Strict(chunk.ciphertextBase64);
      if (!decoded) {
        throw new ConnectError(
          'Uploaded chunk data is invalid base64',
          Code.InvalidArgument
        );
      }
      if (decoded.byteLength !== chunk.ciphertextLength) {
        throw new ConnectError(
          'Chunk ciphertext length mismatch',
          Code.AlreadyExists
        );
      }

      decodedChunks.push(decoded);
      totalCiphertextBytes += chunk.ciphertextLength;
      totalPlaintextBytes += chunk.plaintextLength;
    }

    if (totalCiphertextBytes !== payload.totalCiphertextBytes) {
      throw new ConnectError(
        'Ciphertext size does not match commit payload',
        Code.AlreadyExists
      );
    }
    if (totalPlaintextBytes !== payload.totalPlaintextBytes) {
      throw new ConnectError(
        'Plaintext size does not match commit payload',
        Code.AlreadyExists
      );
    }

    const mergedCiphertext = new Uint8Array(totalCiphertextBytes);
    let offset = 0;
    for (const chunk of decodedChunks) {
      mergedCiphertext.set(chunk, offset);
      offset += chunk.byteLength;
    }

    await persistVfsBlobData({
      blobId,
      data: mergedCiphertext
    });
    await deleteBlobUploadSession({
      stagingId,
      uploadId: payload.uploadId
    });

    return {
      committed: true,
      stagingId,
      uploadId: payload.uploadId,
      blobId
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to persist staged blob commit data:', error);
    throw new ConnectError('Failed to commit staged blob', Code.Internal);
  }
}
