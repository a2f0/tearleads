import { randomUUID } from 'node:crypto';
import type { VfsPermissionLevel, VfsShare, VfsShareType } from '@rapid/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseCreateSharePayload } from './shared.js';

/**
 * @openapi
 * /vfs/items/{itemId}/shares:
 *   post:
 *     summary: Create a new share for a VFS item
 *     description: Share an item with a user, group, or organization.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shareType
 *               - targetId
 *               - permissionLevel
 *             properties:
 *               shareType:
 *                 type: string
 *                 enum: [user, group, organization]
 *               targetId:
 *                 type: string
 *               permissionLevel:
 *                 type: string
 *                 enum: [view, edit, download]
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Share created successfully
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Item or target not found
 *       409:
 *         description: Share already exists
 *       500:
 *         description: Server error
 */
export const postItemsItemidSharesHandler = async (
  req: Request<{ itemId: string }>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseCreateSharePayload({
    ...req.body,
    itemId: req.params.itemId
  });
  if (!payload) {
    res.status(400).json({
      error: 'shareType, targetId, and permissionLevel are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const itemResult = await pool.query<{
      id: string;
      owner_id: string | null;
    }>('SELECT id, owner_id FROM vfs_registry WHERE id = $1', [payload.itemId]);
    if (!itemResult.rows[0]) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    if (itemResult.rows[0].owner_id !== claims.sub) {
      res.status(403).json({ error: 'Not authorized to share this item' });
      return;
    }

    let targetExists = false;
    let targetName = 'Unknown';
    if (payload.shareType === 'user') {
      const result = await pool.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [payload.targetId]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].email;
      }
    } else if (payload.shareType === 'group') {
      const result = await pool.query<{ name: string }>(
        'SELECT name FROM groups WHERE id = $1',
        [payload.targetId]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].name;
      }
    } else if (payload.shareType === 'organization') {
      const result = await pool.query<{ name: string }>(
        'SELECT name FROM organizations WHERE id = $1',
        [payload.targetId]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].name;
      }
    }

    if (!targetExists) {
      res.status(404).json({ error: `${payload.shareType} not found` });
      return;
    }

    const id = randomUUID();
    const now = new Date();
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;

    const result = await pool.query<{
      id: string;
      item_id: string;
      share_type: VfsShareType;
      target_id: string;
      permission_level: VfsPermissionLevel;
      created_by: string;
      created_at: Date;
      expires_at: Date | null;
    }>(
      `INSERT INTO vfs_shares (id, item_id, share_type, target_id, permission_level, created_by, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, item_id, share_type, target_id, permission_level, created_by, created_at, expires_at`,
      [
        id,
        payload.itemId,
        payload.shareType,
        payload.targetId,
        payload.permissionLevel,
        claims.sub,
        now,
        expiresAt
      ]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Failed to create share' });
      return;
    }

    const creatorResult = await pool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [claims.sub]
    );

    const share: VfsShare = {
      id: row.id,
      itemId: row.item_id,
      shareType: row.share_type,
      targetId: row.target_id,
      targetName,
      permissionLevel: row.permission_level,
      createdBy: row.created_by,
      createdByEmail: creatorResult.rows[0]?.email ?? 'Unknown',
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null
    };

    res.status(201).json({ share });
  } catch (error) {
    console.error('Failed to create VFS share:', error);
    if (
      error instanceof Error &&
      error.message.includes('duplicate key value violates unique constraint')
    ) {
      res.status(409).json({ error: 'Share already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create share' });
  }
};

export function registerPostItemsItemidSharesRoute(
  routeRouter: RouterType
): void {
  routeRouter.post('/items/:itemId/shares', postItemsItemidSharesHandler);
}
