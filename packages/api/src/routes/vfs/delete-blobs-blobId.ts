import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { deleteVfsBlobData } from '../../lib/vfsBlobStore.js';
import { normalizeRequiredString } from './blob-shared.js';

interface BlobRegistryRow {
  object_type: string;
  owner_id: string | null;
}

export const deleteBlobsBlobIdHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const blobId = normalizeRequiredString(req.params['blobId']);
  if (!blobId) {
    res.status(400).json({ error: 'blobId is required' });
    return;
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const blobRegistryResult = await client.query<BlobRegistryRow>(
      `
      SELECT object_type, owner_id
      FROM vfs_registry
      WHERE id = $1::text
      LIMIT 1
      FOR UPDATE
      `,
      [blobId]
    );
    const blobRegistryRow = blobRegistryResult.rows[0];
    if (!blobRegistryRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(404).json({ error: 'Blob object not found' });
      return;
    }

    if (blobRegistryRow.object_type !== 'blob') {
      await client.query('ROLLBACK');
      inTransaction = false;
      res
        .status(409)
        .json({ error: 'Blob object id conflicts with existing VFS object' });
      return;
    }

    if (blobRegistryRow.owner_id !== claims.sub) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const attachedLinkResult = await client.query(
      `
      SELECT 1
      FROM vfs_links
      WHERE child_id = $1::text
        AND wrapped_session_key LIKE 'blob-link:%'
      LIMIT 1
      FOR UPDATE
      `,
      [blobId]
    );
    if (attachedLinkResult.rows.length > 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      res.status(409).json({ error: 'Blob is attached and cannot be deleted' });
      return;
    }

    const deleted = await client.query(
      `
      DELETE FROM vfs_registry
      WHERE id = $1::text
        AND object_type = 'blob'
      `,
      [blobId]
    );
    if ((deleted.rowCount ?? 0) < 1) {
      throw new Error('Failed to delete blob registry row');
    }

    await deleteVfsBlobData({ blobId });

    await client.query('COMMIT');
    inTransaction = false;
    res.status(200).json({ deleted: true, blobId });
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }
    console.error('Failed to delete blob data:', error);
    res.status(500).json({ error: 'Failed to delete blob data' });
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

export function registerDeleteBlobsBlobIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/blobs/:blobId', deleteBlobsBlobIdHandler);
}
