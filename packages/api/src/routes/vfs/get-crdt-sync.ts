import {
  buildVfsCrdtSyncQuery,
  mapVfsCrdtSyncRows,
  parseVfsCrdtSyncQuery,
  type VfsCrdtSyncDbRow
} from '@tearleads/sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /vfs/crdt/sync:
 *   get:
 *     summary: Incremental VFS CRDT operation feed
 *     description: Returns cursor-paginated CRDT operations visible to the authenticated user.
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
 *         description: Opaque cursor returned from a previous CRDT sync page.
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *         description: Maximum number of operations to return, default 100.
 *       - in: query
 *         name: rootId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional root ID to limit CRDT operations to a partial view.
 *     responses:
 *       200:
 *         description: Incremental CRDT operation page
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
export const getCrdtSyncHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedQuery = parseVfsCrdtSyncQuery({
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
    const query = buildVfsCrdtSyncQuery({
      userId: claims.sub,
      limit: parsedQuery.value.limit,
      cursor: parsedQuery.value.cursor,
      rootId: parsedQuery.value.rootId
    });

    const result = await pool.query<VfsCrdtSyncDbRow>(query.text, query.values);
    res.json(mapVfsCrdtSyncRows(result.rows, parsedQuery.value.limit));
  } catch (error) {
    console.error('Failed to sync VFS CRDT operations:', error);
    res.status(500).json({ error: 'Failed to sync VFS CRDT operations' });
  }
};

export function registerGetCrdtSyncRoute(routeRouter: RouterType): void {
  routeRouter.get('/crdt/sync', getCrdtSyncHandler);
}
