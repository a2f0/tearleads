import type { MlsGroupState, MlsGroupStateResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getActiveMlsGroupMembership } from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}/state:
 *   get:
 *     summary: Get latest MLS state snapshot for recovery
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
 *         description: Latest state snapshot
 */
const getGroupsGroupidStateHandler = async (req: Request, res: Response) => {
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

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const result = await pool.query<{
      id: string;
      group_id: string;
      epoch: number;
      encrypted_state: string;
      state_hash: string;
      created_at: Date;
    }>(
      `SELECT id, group_id, epoch, encrypted_state, state_hash, created_at
       FROM mls_group_state
       WHERE group_id = $1 AND user_id = $2
       ORDER BY epoch DESC
       LIMIT 1`,
      [groupId, claims.sub]
    );

    if (result.rows.length === 0) {
      const response: MlsGroupStateResponse = { state: null };
      res.json(response);
      return;
    }

    const row = result.rows[0];
    if (!row) {
      const response: MlsGroupStateResponse = { state: null };
      res.json(response);
      return;
    }

    const state: MlsGroupState = {
      id: row.id,
      groupId: row.group_id,
      epoch: row.epoch,
      encryptedState: row.encrypted_state,
      stateHash: row.state_hash,
      createdAt: row.created_at.toISOString()
    };

    const response: MlsGroupStateResponse = { state };
    res.json(response);
  } catch (error) {
    console.error('Failed to get state:', error);
    res.status(500).json({ error: 'Failed to get state' });
  }
};

export function registerGetGroupsGroupidStateRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/groups/:groupId/state', getGroupsGroupidStateHandler);
}
