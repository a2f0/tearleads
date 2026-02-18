import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { isPostgresErrorWithCode, normalizeRequiredString } from './blob-shared.js';
import { readVfsBlobData } from '../../lib/vfsBlobStore.js';

interface BlobRegistryRow {
  object_type: string;
  owner_id: string | null;
}

export const getBlobsBlobIdHandler = async (req: Request, res: Response) => {
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

  try {
    const pool = await getPostgresPool();
    const blobRegistryResult = await pool.query<BlobRegistryRow>(
      `
      SELECT object_type, owner_id
      FROM vfs_registry
      WHERE id = $1::text
      LIMIT 1
      `,
      [blobId]
    );
    const blobRegistryRow = blobRegistryResult.rows[0];
    if (!blobRegistryRow) {
      res.status(404).json({ error: 'Blob object not found' });
      return;
    }

    if (blobRegistryRow.object_type !== 'blob') {
      res
        .status(409)
        .json({ error: 'Blob object id conflicts with existing VFS object' });
      return;
    }

    if (blobRegistryRow.owner_id !== claims.sub) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const blobData = await readVfsBlobData({ blobId });
    res.setHeader('Content-Type', blobData.contentType ?? 'application/octet-stream');
    res.status(200).send(Buffer.from(blobData.data));
  } catch (error) {
    if (isPostgresErrorWithCode(error, '23503')) {
      res.status(404).json({ error: 'Blob object not found' });
      return;
    }

    console.error('Failed to read blob data:', error);
    res.status(500).json({ error: 'Failed to read blob data' });
  }
};

export function registerGetBlobsBlobIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/blobs/:blobId', getBlobsBlobIdHandler);
}

