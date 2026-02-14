import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { isPostgresErrorWithCode, parseBlobStageBody } from './blob-shared.js';

export const postBlobsStageHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedBody = parseBlobStageBody(req.body);
  if (!parsedBody) {
    res.status(400).json({ error: 'blobId and expiresAt are required' });
    return;
  }

  if (Date.parse(parsedBody.expiresAt) <= Date.now()) {
    res.status(400).json({ error: 'expiresAt must be in the future' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      blob_id: string;
      status: string;
      staged_at: Date | string;
      expires_at: Date | string;
    }>(
      `
      INSERT INTO vfs_blob_staging (
        id,
        blob_id,
        staged_by,
        status,
        staged_at,
        expires_at
      ) VALUES (
        $1::text,
        $2::text,
        $3::text,
        'staged',
        NOW(),
        $4::timestamptz
      )
      RETURNING id, blob_id, status, staged_at, expires_at
      `,
      [
        parsedBody.stagingId,
        parsedBody.blobId,
        claims.sub,
        parsedBody.expiresAt
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to stage blob');
    }

    res.status(201).json({
      stagingId: row.id,
      blobId: row.blob_id,
      status: row.status,
      stagedAt:
        row.staged_at instanceof Date
          ? row.staged_at.toISOString()
          : new Date(row.staged_at).toISOString(),
      expiresAt:
        row.expires_at instanceof Date
          ? row.expires_at.toISOString()
          : new Date(row.expires_at).toISOString()
    });
  } catch (error) {
    if (isPostgresErrorWithCode(error, '23503')) {
      res.status(404).json({ error: 'Blob object not found' });
      return;
    }

    if (isPostgresErrorWithCode(error, '23505')) {
      res.status(409).json({ error: 'Blob staging already exists' });
      return;
    }

    console.error('Failed to stage blob for VFS attach:', error);
    res.status(500).json({ error: 'Failed to stage blob' });
  }
};

export function registerPostBlobsStageRoute(routeRouter: RouterType): void {
  routeRouter.post('/blobs/stage', postBlobsStageHandler);
}
