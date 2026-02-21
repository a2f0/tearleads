import type { MlsGroup } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseUpdateGroupPayload,
  toSafeCipherSuite
} from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}:
 *   patch:
 *     summary: Update MLS group metadata
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group updated
 */
const patchGroupsGroupidHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  const payload = parseUpdateGroupPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'At least one field to update is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    if (membership.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can update group' });
      return;
    }

    // Build update query
    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (payload.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(payload.name);
    }
    if (payload.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(payload.description);
    }

    values.push(groupId);

    const result = await pool.query<{
      id: string;
      group_id_mls: string;
      name: string;
      description: string | null;
      creator_user_id: string;
      current_epoch: number;
      cipher_suite: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE mls_groups SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, group_id_mls, name, description, creator_user_id,
                 current_epoch, cipher_suite, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group: MlsGroup = {
      id: row.id,
      groupIdMls: row.group_id_mls,
      name: row.name,
      description: row.description,
      creatorUserId: row.creator_user_id,
      currentEpoch: row.current_epoch,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };

    res.json({ group });
  } catch (error) {
    console.error('Failed to update group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
};

export function registerPatchGroupsGroupidRoute(routeRouter: RouterType): void {
  routeRouter.patch('/groups/:groupId', patchGroupsGroupidHandler);
}
