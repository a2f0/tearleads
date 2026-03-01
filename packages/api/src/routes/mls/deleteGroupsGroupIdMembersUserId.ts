import { randomUUID } from 'node:crypto';
import type { Request, Response, Router as RouterType } from 'express';
import { broadcast } from '../../lib/broadcast.js';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseRemoveMemberPayload
} from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}/members/{userId}:
 *   delete:
 *     summary: Remove member from MLS group
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
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Member removed
 */
const deleteGroupsGroupidMembersUseridHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  const userIdParam = req.params['userId'];
  if (
    !groupIdParam ||
    typeof groupIdParam !== 'string' ||
    !userIdParam ||
    typeof userIdParam !== 'string'
  ) {
    res.status(400).json({ error: 'groupId and userId are required' });
    return;
  }
  const groupId = groupIdParam;
  const userId = userIdParam;

  const payload = parseRemoveMemberPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid remove member payload' });
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
      res.status(403).json({ error: 'Only admins can remove members' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const epochResult = await client.query<{ current_epoch: number }>(
        `SELECT current_epoch FROM mls_groups WHERE id = $1 FOR UPDATE`,
        [groupId]
      );
      const currentEpoch = epochResult.rows[0]?.current_epoch;
      if (typeof currentEpoch !== 'number') {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const expectedEpoch = currentEpoch + 1;
      if (payload.newEpoch !== expectedEpoch) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Epoch mismatch' });
        return;
      }

      // Mark as removed
      const result = await client.query(
        `UPDATE mls_group_members SET removed_at = NOW()
           WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
        [groupId, userId]
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      // Store commit with atomic sequence number generation
      const commitId = randomUUID();
      await client.query(
        `INSERT INTO mls_messages (
            id, group_id, sender_user_id, epoch, ciphertext, message_type, sequence_number, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'commit',
            COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
            NOW()
          )`,
        [commitId, groupId, claims.sub, payload.newEpoch, payload.commit]
      );

      // Update group epoch
      await client.query(
        `UPDATE mls_groups SET current_epoch = $1, updated_at = NOW() WHERE id = $2`,
        [payload.newEpoch, groupId]
      );

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }

    // Broadcast to group
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:member_removed',
      payload: { groupId, userId },
      timestamp: new Date().toISOString()
    });

    res.status(204).send();
  } catch (error) {
    console.error('Failed to remove member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

export function registerDeleteGroupsGroupidMembersUseridRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete(
    '/groups/:groupId/members/:userId',
    deleteGroupsGroupidMembersUseridHandler
  );
}
