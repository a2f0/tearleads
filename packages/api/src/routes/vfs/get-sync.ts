import {
  buildVfsSyncQuery,
  mapVfsSyncRows,
  parseVfsSyncQuery,
  type VfsSyncDbRow
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /vfs/vfs-sync:
 *   get:
 *     summary: Incremental VFS sync feed with ACL filtering
 *     description: Returns a cursor-paginated stream of VFS changes visible to the authenticated user.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: string
 *         description: Opaque cursor returned from a previous sync page.
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *         description: Maximum number of items to return, default 100.
 *       - in: query
 *         name: rootId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional folder/root ID to limit results to a partial subtree view.
 *     responses:
 *       200:
 *         description: Incremental sync page
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const getSyncHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedQuery = parseVfsSyncQuery({
    limit: req.query['limit'],
    cursor: req.query['cursor'],
    rootId: req.query['rootId']
  });
  if (!parsedQuery.ok) {
    res.status(400).json({ error: parsedQuery.error });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const query = buildVfsSyncQuery({
      userId: claims.sub,
      limit: parsedQuery.value.limit,
      cursor: parsedQuery.value.cursor,
      rootId: parsedQuery.value.rootId
    });
    const result = await pool.query<VfsSyncDbRow>(query.text, query.values);
    res.json(mapVfsSyncRows(result.rows, parsedQuery.value.limit));
  } catch (error) {
    console.error('Failed to sync VFS changes:', error);
    res.status(500).json({ error: 'Failed to sync VFS changes' });
  }
};

export function registerGetSyncRoute(routeRouter: RouterType): void {
  routeRouter.get('/vfs-sync', getSyncHandler);
}
