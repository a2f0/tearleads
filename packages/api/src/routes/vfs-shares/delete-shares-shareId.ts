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
    const result = await pool.query('DELETE FROM vfs_shares WHERE id = $1', [
      shareId
    ]);

    /**
     * Guardrail: deleting a share must also revoke canonical ACL visibility for
     * the same principal. Upsert keeps this deterministic even for legacy rows
     * that were created before ACL dual-write existed.
     */
    const revokedAt = new Date();
    await pool.query(
      `INSERT INTO vfs_acl_entries (
          id,
          item_id,
          principal_type,
          principal_id,
          access_level,
          wrapped_session_key,
          wrapped_hierarchical_key,
          granted_by,
          created_at,
          updated_at,
          expires_at,
          revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, $7, NULL, $7)
        ON CONFLICT (item_id, principal_type, principal_id)
        DO UPDATE SET
          access_level = EXCLUDED.access_level,
          granted_by = EXCLUDED.granted_by,
          updated_at = EXCLUDED.updated_at,
          revoked_at = EXCLUDED.revoked_at`,
      [
        `share:${shareId}`,
        authContext.itemId,
        authContext.shareType,
        authContext.targetId,
        authContext.accessLevel,
        claims.sub,
        revokedAt
      ]
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
