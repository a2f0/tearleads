import { randomUUID } from 'node:crypto';
import type { VfsShare, VfsShareType } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  buildShareAclId,
  extractShareIdFromAclId,
  mapAclAccessLevelToSharePermissionLevel,
  mapSharePermissionLevelToAclAccessLevel,
  parseCreateSharePayload,
  type VfsAclAccessLevel
} from './shared.js';

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
        `SELECT u.email
           FROM users u
          WHERE u.id = $1
            AND EXISTS (
              SELECT 1
                FROM user_organizations requestor_uo
                INNER JOIN user_organizations target_uo
                  ON target_uo.organization_id = requestor_uo.organization_id
               WHERE requestor_uo.user_id = $2
                 AND target_uo.user_id = u.id
            )
          LIMIT 1`,
        [payload.targetId, claims.sub]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].email;
      }
    } else if (payload.shareType === 'group') {
      const result = await pool.query<{ name: string }>(
        `SELECT g.name
           FROM groups g
           INNER JOIN user_organizations uo
             ON uo.organization_id = g.organization_id
          WHERE g.id = $1
            AND uo.user_id = $2
          LIMIT 1`,
        [payload.targetId, claims.sub]
      );
      if (result.rows[0]) {
        targetExists = true;
        targetName = result.rows[0].name;
      }
    } else if (payload.shareType === 'organization') {
      const result = await pool.query<{ name: string }>(
        `SELECT o.name
           FROM organizations o
           INNER JOIN user_organizations uo
             ON uo.organization_id = o.id
          WHERE o.id = $1
            AND uo.user_id = $2
          LIMIT 1`,
        [payload.targetId, claims.sub]
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

    const shareId = randomUUID();
    const aclId = buildShareAclId(shareId);
    const now = new Date();
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    const wrappedKeyMetadata =
      payload.wrappedKey === null
        ? null
        : JSON.stringify({
            recipientPublicKeyId: payload.wrappedKey.recipientPublicKeyId,
            senderSignature: payload.wrappedKey.senderSignature
          });

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
      `INSERT INTO vfs_acl_entries (
          id,
          item_id,
          principal_type,
          principal_id,
          access_level,
          wrapped_session_key,
          wrapped_hierarchical_key,
          key_epoch,
          granted_by,
          created_at,
          updated_at,
          expires_at,
          revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, NULL)
        ON CONFLICT (item_id, principal_type, principal_id)
        DO UPDATE SET
          id = EXCLUDED.id,
          access_level = EXCLUDED.access_level,
          wrapped_session_key = EXCLUDED.wrapped_session_key,
          wrapped_hierarchical_key = EXCLUDED.wrapped_hierarchical_key,
          key_epoch = EXCLUDED.key_epoch,
          granted_by = EXCLUDED.granted_by,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          expires_at = EXCLUDED.expires_at,
          revoked_at = NULL
        WHERE vfs_acl_entries.revoked_at IS NOT NULL
        RETURNING
          id AS acl_id,
          item_id,
          principal_type AS share_type,
          principal_id AS target_id,
          access_level,
          granted_by AS created_by,
          created_at,
          expires_at`,
      [
        aclId,
        payload.itemId,
        payload.shareType,
        payload.targetId,
        mapSharePermissionLevelToAclAccessLevel(payload.permissionLevel),
        payload.wrappedKey?.encryptedKey ?? null,
        wrappedKeyMetadata,
        payload.wrappedKey?.keyEpoch ?? null,
        claims.sub,
        now,
        expiresAt
      ]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(409).json({ error: 'Share already exists' });
      return;
    }

    const creatorId = row.created_by ?? claims.sub;
    const creatorResult = await pool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [creatorId]
    );

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
      createdByEmail: creatorResult.rows[0]?.email ?? 'Unknown',
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      ...(payload.wrappedKey !== null && { wrappedKey: payload.wrappedKey })
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
