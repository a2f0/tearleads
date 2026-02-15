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
    const result = await pool.query('DELETE FROM org_shares WHERE id = $1', [
      shareId
    ]);

    /**
     * Guardrail: deleting org shares must revoke canonical org ACL visibility.
     * Upsert keeps behavior deterministic for pre-dual-write historical rows.
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
        `org-share:${shareId}`,
        authContext.itemId,
        'organization',
        authContext.targetOrgId,
        authContext.accessLevel,
        claims.sub,
        revokedAt
      ]
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
