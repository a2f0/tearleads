import type { VfsShare, VfsShareType } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  extractShareIdFromAclId,
  loadShareAuthorizationContext,
  mapAclAccessLevelToSharePermissionLevel,
  mapSharePermissionLevelToAclAccessLevel,
  parseUpdateSharePayload,
  type VfsAclAccessLevel
} from './shared.js';

/**
 * @openapi
 * /vfs/shares/{shareId}:
 *   patch:
 *     summary: Update a share
 *     description: Update permission level or expiration date of a share.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permissionLevel:
 *                 type: string
 *                 enum: [view, edit, download]
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Share updated successfully
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Share not found
 *       500:
 *         description: Server error
 */
const patchSharesShareidHandler = async (
  req: Request<{ shareId: string }>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseUpdateSharePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid update payload' });
    return;
  }

  if (
    payload.permissionLevel === undefined &&
    payload.expiresAt === undefined
  ) {
    res.status(400).json({ error: 'No fields to update' });
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
      res.status(403).json({ error: 'Not authorized to update this share' });
      return;
    }

    const updates: string[] = [];
    const values: (string | Date | null)[] = [];
    let paramIndex = 1;

    if (payload.permissionLevel !== undefined) {
      updates.push(`access_level = $${paramIndex++}`);
      values.push(
        mapSharePermissionLevelToAclAccessLevel(payload.permissionLevel)
      );
    }

    if (payload.expiresAt !== undefined) {
      updates.push(`expires_at = $${paramIndex++}`);
      values.push(payload.expiresAt ? new Date(payload.expiresAt) : null);
    }

    const now = new Date();
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);
    values.push(authContext.aclId);

    const result = await pool.query<{
      acl_id: string;
      item_id: string;
      share_type: VfsShareType;
      target_id: string;
      access_level: VfsAclAccessLevel;
      created_by: string | null;
      created_at: Date;
      expires_at: Date | null;
    }>(
      `UPDATE vfs_acl_entries
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
           AND revoked_at IS NULL
         RETURNING
           id AS acl_id,
           item_id,
           principal_type AS share_type,
           principal_id AS target_id,
           access_level,
           granted_by AS created_by,
           created_at,
           expires_at`,
      values
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    let targetName = 'Unknown';
    if (row.share_type === 'user') {
      const r = await pool.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [row.target_id]
      );
      targetName = r.rows[0]?.email ?? 'Unknown';
    } else if (row.share_type === 'group') {
      const r = await pool.query<{ name: string }>(
        'SELECT name FROM groups WHERE id = $1',
        [row.target_id]
      );
      targetName = r.rows[0]?.name ?? 'Unknown';
    } else if (row.share_type === 'organization') {
      const r = await pool.query<{ name: string }>(
        'SELECT name FROM organizations WHERE id = $1',
        [row.target_id]
      );
      targetName = r.rows[0]?.name ?? 'Unknown';
    }

    const creatorId = row.created_by ?? 'unknown';
    const creatorEmail =
      row.created_by === null
        ? 'Unknown'
        : ((
            await pool.query<{ email: string }>(
              'SELECT email FROM users WHERE id = $1',
              [row.created_by]
            )
          ).rows[0]?.email ?? 'Unknown');

    const share: VfsShare = {
      id: extractShareIdFromAclId(row.acl_id),
      itemId: row.item_id,
      shareType: row.share_type,
      targetId: row.target_id,
      targetName,
      permissionLevel: mapAclAccessLevelToSharePermissionLevel(
        row.access_level
      ),
      createdBy: creatorId,
      createdByEmail: creatorEmail,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null
    };

    res.json({ share });
  } catch (error) {
    console.error('Failed to update VFS share:', error);
    res.status(500).json({ error: 'Failed to update share' });
  }
};

export function registerPatchSharesShareidRoute(routeRouter: RouterType): void {
  routeRouter.patch('/shares/:shareId', patchSharesShareidHandler);
}
