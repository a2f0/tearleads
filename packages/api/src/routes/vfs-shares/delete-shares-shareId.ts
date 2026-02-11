import { type Request, type Response, type Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

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

    const authCheckResult = await pool.query<{ owner_id: string | null }>(
      `SELECT r.owner_id
         FROM vfs_shares s
         JOIN vfs_registry r ON r.id = s.item_id
         WHERE s.id = $1`,
      [shareId]
    );
    if (!authCheckResult.rows[0]) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }
    if (authCheckResult.rows[0].owner_id !== claims.sub) {
      res.status(403).json({ error: 'Not authorized to delete this share' });
      return;
    }

    const result = await pool.query('DELETE FROM vfs_shares WHERE id = $1', [
      shareId
    ]);

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
