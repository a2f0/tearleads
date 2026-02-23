import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { deleteBlobUploadSessionsForStaging } from './blobUploadSessions.js';
import { normalizeRequiredString } from './blob-shared.js';

interface BlobStagingStateRow {
  id: string;
  staged_by: string | null;
  status: string;
}

const postBlobsStageStagingIdAbandonHandler = async (
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
      SELECT
        stage_registry.id AS id,
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

    const abandonedAtIso = new Date().toISOString();
    /**
     * Guardrail: abandon is only valid for staged rows. Conditional update keeps
     * attach/abandon races deterministic.
     */
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
      res.status(409).json({ error: 'Blob staging is no longer abandonable' });
      return;
    }

    await deleteBlobUploadSessionsForStaging({ stagingId });

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
