import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { normalizeRequiredString } from './blob-shared.js';

interface BlobStagingStateRow {
  id: string;
  staged_by: string;
  status: string;
}

export const postBlobsStageStagingIdAbandonHandler = async (
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

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const stagedResult = await client.query<BlobStagingStateRow>(
      `
      SELECT id, staged_by, status
      FROM vfs_blob_staging
      WHERE id = $1::text
      FOR UPDATE
      `,
      [stagingId]
    );

    const stagedRow = stagedResult.rows[0];
    if (!stagedRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(404).json({ error: 'Blob staging not found' });
      return;
    }

    if (stagedRow.staged_by !== claims.sub) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (stagedRow.status !== 'staged') {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(409).json({ error: 'Blob staging is no longer abandonable' });
      return;
    }

    const updatedResult = await client.query(
      `
      UPDATE vfs_blob_staging
      SET status = 'abandoned'
      WHERE id = $1::text
        AND status = 'staged'
      `,
      [stagingId]
    );

    if ((updatedResult.rowCount ?? 0) < 1) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(409).json({ error: 'Blob staging is no longer abandonable' });
      return;
    }

    await client.query('COMMIT');
    inTransaction = false;

    res.status(200).json({
      abandoned: true,
      stagingId,
      status: 'abandoned'
    });
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    console.error('Failed to abandon staged blob:', error);
    res.status(500).json({ error: 'Failed to abandon staged blob' });
  } finally {
    client.release();
  }
};

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

export function registerPostBlobsStageStagingIdAbandonRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/blobs/stage/:stagingId/abandon',
    postBlobsStageStagingIdAbandonHandler
  );
}
