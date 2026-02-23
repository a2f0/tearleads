import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { persistVfsBlobData } from '../../lib/vfsBlobStore.js';
import { normalizeRequiredString, parseBlobCommitBody } from './blob-shared.js';
import {
  deleteBlobUploadSession,
  getBlobUploadChunks
} from './blobUploadSessions.js';

interface BlobStagingRow {
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

const postBlobsStageStagingIdCommitHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const stagingId = normalizeRequiredString(req.params['stagingId']);
  if (!stagingId) {
    res.status(400).json({ error: 'stagingId is required' });
    return;
  }

  const payload = parseBlobCommitBody(req.body);
  if (!payload) {
    res.status(400).json({ error: 'commit payload is invalid' });
    return;
  }

  const pool = await getPostgresPool();
  const stagedResult = await pool.query<BlobStagingRow>(
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
    res.status(404).json({ error: 'Blob staging not found' });
    return;
  }
  if (stagedRow.staged_by !== claims.sub) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (stagedRow.status !== 'staged') {
    res.status(409).json({ error: 'Blob staging is no longer committable' });
    return;
  }

  const blobId = normalizeRequiredString(stagedRow.blob_id);
  if (!blobId) {
    res.status(500).json({ error: 'Failed to commit staged blob' });
    return;
  }

  const chunks = await getBlobUploadChunks({
    stagingId,
    uploadId: payload.uploadId
  });
  if (!chunks || chunks.length === 0) {
    res.status(409).json({ error: 'No uploaded chunks found for staging' });
    return;
  }

  if (chunks.length !== payload.chunkCount) {
    res
      .status(409)
      .json({ error: 'Chunk count does not match commit payload' });
    return;
  }

  const decodedChunks: Uint8Array[] = [];
  let totalCiphertextBytes = 0;
  let totalPlaintextBytes = 0;

  for (const [index, chunk] of chunks.entries()) {
    if (chunk.chunkIndex !== index) {
      res.status(409).json({ error: 'Chunks must be contiguous from index 0' });
      return;
    }

    const shouldBeFinal = index === chunks.length - 1;
    if (chunk.isFinal !== shouldBeFinal) {
      res.status(409).json({ error: 'Chunk finality does not match ordering' });
      return;
    }

    const decoded = decodeBase64Strict(chunk.ciphertextBase64);
    if (!decoded) {
      res.status(400).json({ error: 'Uploaded chunk data is invalid base64' });
      return;
    }
    if (decoded.byteLength !== chunk.ciphertextLength) {
      res.status(409).json({ error: 'Chunk ciphertext length mismatch' });
      return;
    }

    decodedChunks.push(decoded);
    totalCiphertextBytes += chunk.ciphertextLength;
    totalPlaintextBytes += chunk.plaintextLength;
  }

  if (totalCiphertextBytes !== payload.totalCiphertextBytes) {
    res
      .status(409)
      .json({ error: 'Ciphertext size does not match commit payload' });
    return;
  }
  if (totalPlaintextBytes !== payload.totalPlaintextBytes) {
    res
      .status(409)
      .json({ error: 'Plaintext size does not match commit payload' });
    return;
  }

  const mergedCiphertext = new Uint8Array(totalCiphertextBytes);
  let offset = 0;
  for (const chunk of decodedChunks) {
    mergedCiphertext.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    await persistVfsBlobData({
      blobId,
      data: mergedCiphertext
    });
    await deleteBlobUploadSession({
      stagingId,
      uploadId: payload.uploadId
    });
  } catch (error) {
    console.error('Failed to persist staged blob commit data:', error);
    res.status(500).json({ error: 'Failed to commit staged blob' });
    return;
  }

  res.status(200).json({
    committed: true,
    stagingId,
    uploadId: payload.uploadId,
    blobId
  });
};

export function registerPostBlobsStageStagingIdCommitRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/blobs/stage/:stagingId/commit',
    postBlobsStageStagingIdCommitHandler
  );
}
