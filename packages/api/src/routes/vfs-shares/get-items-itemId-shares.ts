import type {
  VfsOrgShare,
  VfsPermissionLevel,
  VfsShare,
  VfsSharesResponse,
  VfsShareType
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /vfs/items/{itemId}/shares:
 *   get:
 *     summary: List all shares for a VFS item
 *     description: Returns all shares (user, group, org) and org-to-org shares for the item.
 *     tags:
 *       - VFS Shares
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *         description: The VFS item ID
 *     responses:
 *       200:
 *         description: List of shares
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Item not found
 *       500:
 *         description: Server error
 */
export const getItemsItemidSharesHandler = async (
  req: Request<{ itemId: string }>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { itemId } = req.params;
    const pool = await getPostgresPool();

    const itemResult = await pool.query<{ owner_id: string | null }>(
      'SELECT owner_id FROM vfs_registry WHERE id = $1',
      [itemId]
    );

    if (!itemResult.rows[0]) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    if (itemResult.rows[0].owner_id !== claims.sub) {
      res
        .status(403)
        .json({ error: 'Not authorized to view shares for this item' });
      return;
    }

    const sharesResult = await pool.query<{
      id: string;
      item_id: string;
      share_type: VfsShareType;
      target_id: string;
      permission_level: VfsPermissionLevel;
      created_by: string;
      created_at: Date;
      expires_at: Date | null;
      target_name: string | null;
      created_by_email: string | null;
    }>(
      `SELECT
          s.id,
          s.item_id,
          s.share_type,
          s.target_id,
          s.permission_level,
          s.created_by,
          s.created_at,
          s.expires_at,
          CASE
            WHEN s.share_type = 'user' THEN (SELECT email FROM users WHERE id = s.target_id)
            WHEN s.share_type = 'group' THEN (SELECT name FROM groups WHERE id = s.target_id)
            WHEN s.share_type = 'organization' THEN (SELECT name FROM organizations WHERE id = s.target_id)
          END AS target_name,
          (SELECT email FROM users WHERE id = s.created_by) AS created_by_email
        FROM vfs_shares s
        WHERE s.item_id = $1
        ORDER BY s.created_at DESC`,
      [itemId]
    );

    const shares: VfsShare[] = sharesResult.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      shareType: row.share_type,
      targetId: row.target_id,
      targetName: row.target_name ?? 'Unknown',
      permissionLevel: row.permission_level,
      createdBy: row.created_by,
      createdByEmail: row.created_by_email ?? 'Unknown',
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null
    }));

    const orgSharesResult = await pool.query<{
      id: string;
      source_org_id: string;
      target_org_id: string;
      item_id: string;
      permission_level: VfsPermissionLevel;
      created_by: string;
      created_at: Date;
      expires_at: Date | null;
      source_org_name: string | null;
      target_org_name: string | null;
      created_by_email: string | null;
    }>(
      `SELECT
          os.id,
          os.source_org_id,
          os.target_org_id,
          os.item_id,
          os.permission_level,
          os.created_by,
          os.created_at,
          os.expires_at,
          (SELECT name FROM organizations WHERE id = os.source_org_id) AS source_org_name,
          (SELECT name FROM organizations WHERE id = os.target_org_id) AS target_org_name,
          (SELECT email FROM users WHERE id = os.created_by) AS created_by_email
        FROM org_shares os
        WHERE os.item_id = $1
        ORDER BY os.created_at DESC`,
      [itemId]
    );

    const orgShares: VfsOrgShare[] = orgSharesResult.rows.map((row) => ({
      id: row.id,
      sourceOrgId: row.source_org_id,
      sourceOrgName: row.source_org_name ?? 'Unknown',
      targetOrgId: row.target_org_id,
      targetOrgName: row.target_org_name ?? 'Unknown',
      itemId: row.item_id,
      permissionLevel: row.permission_level,
      createdBy: row.created_by,
      createdByEmail: row.created_by_email ?? 'Unknown',
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null
    }));

    const response: VfsSharesResponse = { shares, orgShares };
    res.json(response);
  } catch (error) {
    console.error('Failed to get VFS shares:', error);
    res.status(500).json({ error: 'Failed to get shares' });
  }
};

export function registerGetItemsItemidSharesRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/items/:itemId/shares', getItemsItemidSharesHandler);
}
