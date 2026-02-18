import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { loadShareAuthorizationContext } from './shared.js';

/**
 * @openapi
 * /vfs/shares/{shareId}:
 *   delete:
 *     summary: Remove a share
 *     description: Remove a share from a VFS item.
 *     tags:
 *       - VFS Shares
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shareId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Share deleted successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
export const deleteSharesShareidHandler = async (
  req: Request<{ shareId: string }>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { shareId } = req.params;
    const pool = await getPostgresPool();

    const authContext = await loadShareAuthorizationContext(pool, shareId);
    if (!authContext) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }
    if (authContext.ownerId !== claims.sub) {
      res.status(403).json({ error: 'Not authorized to delete this share' });
      return;
    }

    const revokedAt = new Date();
    const result = await pool.query(
      `UPDATE vfs_acl_entries
         SET revoked_at = $2,
             updated_at = $2
         WHERE id = $1
           AND revoked_at IS NULL`,
      [authContext.aclId, revokedAt]
    );

    res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
  } catch (error) {
    console.error('Failed to delete VFS share:', error);
    res.status(500).json({ error: 'Failed to delete share' });
  }
};

export function registerDeleteSharesShareidRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/shares/:shareId', deleteSharesShareidHandler);
}
