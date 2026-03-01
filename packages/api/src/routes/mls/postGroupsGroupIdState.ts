import { randomUUID } from 'node:crypto';
import type { MlsGroupState, UploadMlsStateResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseUploadStatePayload
} from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}/state:
 *   post:
 *     summary: Upload encrypted MLS state snapshot
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
 *       201:
 *         description: State uploaded
 */
const postGroupsGroupidStateHandler = async (req: Request, res: Response) => {
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

  const payload = parseUploadStatePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid state payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const groupEpochResult = await pool.query<{ current_epoch: number }>(
      `SELECT current_epoch
         FROM mls_groups
        WHERE id = $1
        LIMIT 1`,
      [groupId]
    );
    const currentEpoch = groupEpochResult.rows[0]?.current_epoch;
    if (typeof currentEpoch !== 'number') {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (payload.epoch > currentEpoch) {
      res.status(409).json({ error: 'State epoch is ahead of group epoch' });
      return;
    }

    // Upsert state (replace if same epoch or older)
    const id = randomUUID();
    const result = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO mls_group_state (
        id, group_id, user_id, epoch, encrypted_state, state_hash, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (group_id, user_id) DO UPDATE SET
        id = EXCLUDED.id,
        epoch = EXCLUDED.epoch,
        encrypted_state = EXCLUDED.encrypted_state,
        state_hash = EXCLUDED.state_hash,
        created_at = NOW()
      WHERE mls_group_state.epoch <= EXCLUDED.epoch
      RETURNING id, created_at`,
      [
        id,
        groupId,
        claims.sub,
        payload.epoch,
        payload.encryptedState,
        payload.stateHash
      ]
    );

    if (result.rows.length === 0) {
      res
        .status(409)
        .json({ error: 'State with a newer epoch already exists' });
      return;
    }

    const state: MlsGroupState = {
      id,
      groupId,
      epoch: payload.epoch,
      encryptedState: payload.encryptedState,
      stateHash: payload.stateHash,
      createdAt: new Date().toISOString()
    };

    const response: UploadMlsStateResponse = { state };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to upload state:', error);
    res.status(500).json({ error: 'Failed to upload state' });
  }
};

export function registerPostGroupsGroupidStateRoute(
  routeRouter: RouterType
): void {
  routeRouter.post('/groups/:groupId/state', postGroupsGroupidStateHandler);
}
