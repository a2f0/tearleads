import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { loadOrgShareAuthorizationContext } from './shared.js';

/**
 * @openapi
 * /vfs/org-shares/{shareId}:
 *   delete:
 *     summary: Remove an organization share
 *     description: Remove an org-to-org share.
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
 *         description: Org share deleted successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const deleteOrgSharesShareidHandler = async (
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

    const authContext = await loadOrgShareAuthorizationContext(pool, shareId);
    if (!authContext) {
      res.status(404).json({ error: 'Org share not found' });
      return;
    }
    if (authContext.ownerId !== claims.sub) {
      res
        .status(403)
        .json({ error: 'Not authorized to delete this org share' });
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
    console.error('Failed to delete org share:', error);
    res.status(500).json({ error: 'Failed to delete org share' });
  }
};

export function registerDeleteOrgSharesShareidRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/org-shares/:shareId', deleteOrgSharesShareidHandler);
}
