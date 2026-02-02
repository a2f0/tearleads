/**
 * VFS Shares API routes.
 *
 * Handles sharing VFS items with users, groups, and organizations.
 */

import { randomUUID } from 'node:crypto';
import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  ShareTargetSearchResponse,
  ShareTargetSearchResult,
  UpdateVfsShareRequest,
  VfsOrgShare,
  VfsPermissionLevel,
  VfsShare,
  VfsSharesResponse,
  VfsShareType
} from '@rapid/shared';
import { isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../lib/postgres.js';

const vfsSharesRouter: RouterType = Router();

const VALID_SHARE_TYPES: VfsShareType[] = ['user', 'group', 'organization'];
const VALID_PERMISSION_LEVELS: VfsPermissionLevel[] = [
  'view',
  'edit',
  'download'
];

function isValidShareType(value: unknown): value is VfsShareType {
  return (
    typeof value === 'string' &&
    VALID_SHARE_TYPES.includes(value as VfsShareType)
  );
}

function isValidPermissionLevel(value: unknown): value is VfsPermissionLevel {
  return (
    typeof value === 'string' &&
    VALID_PERMISSION_LEVELS.includes(value as VfsPermissionLevel)
  );
}

function parseCreateSharePayload(body: unknown): CreateVfsShareRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const { itemId, shareType, targetId, permissionLevel, expiresAt } = body;

  if (
    typeof itemId !== 'string' ||
    !isValidShareType(shareType) ||
    typeof targetId !== 'string' ||
    !isValidPermissionLevel(permissionLevel)
  ) {
    return null;
  }

  if (!itemId.trim() || !targetId.trim()) {
    return null;
  }

  return {
    itemId: itemId.trim(),
    shareType,
    targetId: targetId.trim(),
    permissionLevel,
    expiresAt:
      typeof expiresAt === 'string' && expiresAt.trim()
        ? expiresAt.trim()
        : null
  };
}

function parseCreateOrgSharePayload(
  body: unknown
): CreateOrgShareRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const { itemId, sourceOrgId, targetOrgId, permissionLevel, expiresAt } = body;

  if (
    typeof itemId !== 'string' ||
    typeof sourceOrgId !== 'string' ||
    typeof targetOrgId !== 'string' ||
    !isValidPermissionLevel(permissionLevel)
  ) {
    return null;
  }

  if (!itemId.trim() || !sourceOrgId.trim() || !targetOrgId.trim()) {
    return null;
  }

  return {
    itemId: itemId.trim(),
    sourceOrgId: sourceOrgId.trim(),
    targetOrgId: targetOrgId.trim(),
    permissionLevel,
    expiresAt:
      typeof expiresAt === 'string' && expiresAt.trim()
        ? expiresAt.trim()
        : null
  };
}

function parseUpdateSharePayload(body: unknown): UpdateVfsShareRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const { permissionLevel, expiresAt } = body;

  const result: UpdateVfsShareRequest = {};

  if (permissionLevel !== undefined) {
    if (!isValidPermissionLevel(permissionLevel)) {
      return null;
    }
    result.permissionLevel = permissionLevel;
  }

  if (expiresAt !== undefined) {
    if (expiresAt !== null && typeof expiresAt !== 'string') {
      return null;
    }
    result.expiresAt = expiresAt;
  }

  return result;
}

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
vfsSharesRouter.get(
  '/items/:itemId/shares',
  async (req: Request<{ itemId: string }>, res: Response) => {
    const claims = req.authClaims;
    if (!claims) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const { itemId } = req.params;
      const pool = await getPostgresPool();

      // Verify item exists and user has access
      const itemResult = await pool.query<{ owner_id: string | null }>(
        'SELECT owner_id FROM vfs_registry WHERE id = $1',
        [itemId]
      );

      if (!itemResult.rows[0]) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      // Fetch vfs_shares with resolved target names
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

      // Fetch org_shares
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
  }
);

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
vfsSharesRouter.post(
  '/items/:itemId/shares',
  async (req: Request<{ itemId: string }>, res: Response) => {
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

      // Verify item exists
      const itemResult = await pool.query<{ id: string }>(
        'SELECT id FROM vfs_registry WHERE id = $1',
        [payload.itemId]
      );
      if (!itemResult.rows[0]) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      // Verify target exists
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

      // Get creator email
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
  }
);

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
vfsSharesRouter.patch(
  '/shares/:shareId',
  async (req: Request<{ shareId: string }>, res: Response) => {
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

      const updates: string[] = [];
      const values: (string | Date | null)[] = [];
      let paramIndex = 1;

      if (payload.permissionLevel !== undefined) {
        updates.push(`permission_level = $${paramIndex++}`);
        values.push(payload.permissionLevel);
      }

      if (payload.expiresAt !== undefined) {
        updates.push(`expires_at = $${paramIndex++}`);
        values.push(payload.expiresAt ? new Date(payload.expiresAt) : null);
      }

      values.push(shareId);

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
        `UPDATE vfs_shares
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, item_id, share_type, target_id, permission_level, created_by, created_at, expires_at`,
        values
      );

      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: 'Share not found' });
        return;
      }

      // Get target name and creator email
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

      const creatorResult = await pool.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [row.created_by]
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

      res.json({ share });
    } catch (error) {
      console.error('Failed to update VFS share:', error);
      res.status(500).json({ error: 'Failed to update share' });
    }
  }
);

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
vfsSharesRouter.delete(
  '/shares/:shareId',
  async (req: Request<{ shareId: string }>, res: Response) => {
    const claims = req.authClaims;
    if (!claims) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const { shareId } = req.params;
      const pool = await getPostgresPool();

      const result = await pool.query('DELETE FROM vfs_shares WHERE id = $1', [
        shareId
      ]);

      res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
    } catch (error) {
      console.error('Failed to delete VFS share:', error);
      res.status(500).json({ error: 'Failed to delete share' });
    }
  }
);

/**
 * @openapi
 * /vfs/items/{itemId}/org-shares:
 *   post:
 *     summary: Create an organization-to-organization share
 *     description: Share an item from one organization to another.
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
 *               - sourceOrgId
 *               - targetOrgId
 *               - permissionLevel
 *             properties:
 *               sourceOrgId:
 *                 type: string
 *               targetOrgId:
 *                 type: string
 *               permissionLevel:
 *                 type: string
 *                 enum: [view, edit, download]
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Org share created successfully
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Item or organization not found
 *       409:
 *         description: Org share already exists
 *       500:
 *         description: Server error
 */
vfsSharesRouter.post(
  '/items/:itemId/org-shares',
  async (req: Request<{ itemId: string }>, res: Response) => {
    const claims = req.authClaims;
    if (!claims) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payload = parseCreateOrgSharePayload({
      ...req.body,
      itemId: req.params.itemId
    });
    if (!payload) {
      res.status(400).json({
        error: 'sourceOrgId, targetOrgId, and permissionLevel are required'
      });
      return;
    }

    try {
      const pool = await getPostgresPool();

      // Verify item exists
      const itemResult = await pool.query<{ id: string }>(
        'SELECT id FROM vfs_registry WHERE id = $1',
        [payload.itemId]
      );
      if (!itemResult.rows[0]) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      // Verify source org exists
      const sourceOrgResult = await pool.query<{ name: string }>(
        'SELECT name FROM organizations WHERE id = $1',
        [payload.sourceOrgId]
      );
      if (!sourceOrgResult.rows[0]) {
        res.status(404).json({ error: 'Source organization not found' });
        return;
      }
      const sourceOrgName = sourceOrgResult.rows[0].name;

      // Verify target org exists
      const targetOrgResult = await pool.query<{ name: string }>(
        'SELECT name FROM organizations WHERE id = $1',
        [payload.targetOrgId]
      );
      if (!targetOrgResult.rows[0]) {
        res.status(404).json({ error: 'Target organization not found' });
        return;
      }
      const targetOrgName = targetOrgResult.rows[0].name;

      const id = randomUUID();
      const now = new Date();
      const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;

      const result = await pool.query<{
        id: string;
        source_org_id: string;
        target_org_id: string;
        item_id: string;
        permission_level: VfsPermissionLevel;
        created_by: string;
        created_at: Date;
        expires_at: Date | null;
      }>(
        `INSERT INTO org_shares (id, source_org_id, target_org_id, item_id, permission_level, created_by, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, source_org_id, target_org_id, item_id, permission_level, created_by, created_at, expires_at`,
        [
          id,
          payload.sourceOrgId,
          payload.targetOrgId,
          payload.itemId,
          payload.permissionLevel,
          claims.sub,
          now,
          expiresAt
        ]
      );

      const row = result.rows[0];
      if (!row) {
        res.status(500).json({ error: 'Failed to create org share' });
        return;
      }

      // Get creator email
      const creatorResult = await pool.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [claims.sub]
      );

      const orgShare: VfsOrgShare = {
        id: row.id,
        sourceOrgId: row.source_org_id,
        sourceOrgName,
        targetOrgId: row.target_org_id,
        targetOrgName,
        itemId: row.item_id,
        permissionLevel: row.permission_level,
        createdBy: row.created_by,
        createdByEmail: creatorResult.rows[0]?.email ?? 'Unknown',
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at ? row.expires_at.toISOString() : null
      };

      res.status(201).json({ orgShare });
    } catch (error) {
      console.error('Failed to create org share:', error);
      if (
        error instanceof Error &&
        error.message.includes('duplicate key value violates unique constraint')
      ) {
        res.status(409).json({ error: 'Org share already exists' });
        return;
      }
      res.status(500).json({ error: 'Failed to create org share' });
    }
  }
);

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
vfsSharesRouter.delete(
  '/org-shares/:shareId',
  async (req: Request<{ shareId: string }>, res: Response) => {
    const claims = req.authClaims;
    if (!claims) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const { shareId } = req.params;
      const pool = await getPostgresPool();

      const result = await pool.query('DELETE FROM org_shares WHERE id = $1', [
        shareId
      ]);

      res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
    } catch (error) {
      console.error('Failed to delete org share:', error);
      res.status(500).json({ error: 'Failed to delete org share' });
    }
  }
);

/**
 * @openapi
 * /vfs/share-targets/search:
 *   get:
 *     summary: Search for share targets
 *     description: Search users, groups, or organizations to share with.
 *     tags:
 *       - VFS Shares
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum: [user, group, organization]
 *         description: Filter by target type
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Invalid query
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
vfsSharesRouter.get(
  '/share-targets/search',
  async (
    req: Request<unknown, unknown, unknown, { q?: string; type?: string }>,
    res: Response
  ) => {
    const claims = req.authClaims;
    if (!claims) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { q, type } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length < 1) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    const searchQuery = `%${q.trim().toLowerCase()}%`;
    const filterType =
      type && isValidShareType(type) ? (type as VfsShareType) : null;

    try {
      const pool = await getPostgresPool();
      const results: ShareTargetSearchResult[] = [];

      // Search users
      if (!filterType || filterType === 'user') {
        const usersResult = await pool.query<{ id: string; email: string }>(
          `SELECT id, email FROM users
           WHERE LOWER(email) LIKE $1
           ORDER BY email
           LIMIT 10`,
          [searchQuery]
        );
        for (const row of usersResult.rows) {
          results.push({
            id: row.id,
            type: 'user',
            name: row.email
          });
        }
      }

      // Search groups
      if (!filterType || filterType === 'group') {
        const groupsResult = await pool.query<{
          id: string;
          name: string;
          org_name: string | null;
        }>(
          `SELECT g.id, g.name, o.name AS org_name
           FROM groups g
           LEFT JOIN organizations o ON o.id = g.organization_id
           WHERE LOWER(g.name) LIKE $1
           ORDER BY g.name
           LIMIT 10`,
          [searchQuery]
        );
        for (const row of groupsResult.rows) {
          results.push({
            id: row.id,
            type: 'group',
            name: row.name,
            description: row.org_name ?? undefined
          });
        }
      }

      // Search organizations
      if (!filterType || filterType === 'organization') {
        const orgsResult = await pool.query<{
          id: string;
          name: string;
          description: string | null;
        }>(
          `SELECT id, name, description FROM organizations
           WHERE LOWER(name) LIKE $1
           ORDER BY name
           LIMIT 10`,
          [searchQuery]
        );
        for (const row of orgsResult.rows) {
          results.push({
            id: row.id,
            type: 'organization',
            name: row.name,
            description: row.description ?? undefined
          });
        }
      }

      const response: ShareTargetSearchResponse = { results };
      res.json(response);
    } catch (error) {
      console.error('Failed to search share targets:', error);
      res.status(500).json({ error: 'Failed to search' });
    }
  }
);

export { vfsSharesRouter };
