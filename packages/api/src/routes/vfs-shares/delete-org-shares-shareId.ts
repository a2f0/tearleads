import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

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
export const deleteOrgSharesShareidHandler = async (
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

    const authCheckResult = await pool.query<{ owner_id: string | null }>(
      `SELECT r.owner_id
         FROM org_shares os
         JOIN vfs_registry r ON r.id = os.item_id
         WHERE os.id = $1`,
      [shareId]
    );
    if (!authCheckResult.rows[0]) {
      res.status(404).json({ error: 'Org share not found' });
      return;
    }
    if (authCheckResult.rows[0].owner_id !== claims.sub) {
      res
        .status(403)
        .json({ error: 'Not authorized to delete this org share' });
      return;
    }

    const result = await pool.query('DELETE FROM org_shares WHERE id = $1', [
      shareId
    ]);

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
