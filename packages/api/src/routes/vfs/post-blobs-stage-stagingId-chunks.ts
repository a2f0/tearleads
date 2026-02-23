import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { normalizeRequiredString, parseBlobChunkBody } from './blob-shared.js';
import { upsertBlobUploadChunk } from './blobUploadSessions.js';

interface BlobStagingRow {
  staged_by: string | null;
  status: string;
}

const postBlobsStageStagingIdChunksHandler = async (
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

  const payload = parseBlobChunkBody(req.body);
  if (!payload) {
    res.status(400).json({ error: 'chunk payload is invalid' });
    return;
  }

  const pool = await getPostgresPool();
  const stagedResult = await pool.query<BlobStagingRow>(
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
    res.status(409).json({ error: 'Blob staging is no longer uploadable' });
    return;
  }

  await upsertBlobUploadChunk({
    stagingId,
    uploadId: payload.uploadId,
    chunk: {
      chunkIndex: payload.chunkIndex,
      isFinal: payload.isFinal,
      ciphertextBase64: payload.ciphertextBase64,
      plaintextLength: payload.plaintextLength,
      ciphertextLength: payload.ciphertextLength
    }
  });

  res.status(200).json({
    accepted: true,
    stagingId,
    uploadId: payload.uploadId,
    chunkIndex: payload.chunkIndex
  });
};

export function registerPostBlobsStageStagingIdChunksRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/blobs/stage/:stagingId/chunks',
    postBlobsStageStagingIdChunksHandler
  );
}
