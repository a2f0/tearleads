import { randomUUID } from 'node:crypto';
import type { VfsOrgShare, VfsPermissionLevel } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseCreateOrgSharePayload } from './shared.js';

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
export const postItemsItemidOrgSharesHandler = async (
  req: Request<{ itemId: string }>,
  res: Response
) => {
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

    const sourceOrgResult = await pool.query<{ name: string }>(
      `SELECT o.name
         FROM organizations o
         INNER JOIN user_organizations uo
           ON uo.organization_id = o.id
        WHERE o.id = $1
          AND uo.user_id = $2
        LIMIT 1`,
      [payload.sourceOrgId, claims.sub]
    );
    if (!sourceOrgResult.rows[0]) {
      res.status(404).json({ error: 'Source organization not found' });
      return;
    }
    const sourceOrgName = sourceOrgResult.rows[0].name;

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
};

export function registerPostItemsItemidOrgSharesRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/items/:itemId/org-shares',
    postItemsItemidOrgSharesHandler
  );
}
