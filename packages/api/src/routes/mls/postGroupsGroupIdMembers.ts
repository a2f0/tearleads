import { randomUUID } from 'node:crypto';
import type { AddMlsMemberResponse, MlsGroupMember } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { broadcast } from '../../lib/broadcast.js';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseAddMemberPayload
} from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}/members:
 *   post:
 *     summary: Add member to MLS group
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
 *         description: Member added
 */
const postGroupsGroupidMembersHandler = async (req: Request, res: Response) => {
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

  const payload = parseAddMemberPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid add member payload' });
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
      res.status(403).json({ error: 'Only admins can add members' });
      return;
    }

    const targetOrganizationMembership = await pool.query(
      `SELECT 1
         FROM user_organizations
        WHERE user_id = $1
          AND organization_id = $2
        LIMIT 1`,
      [payload.userId, membership.organizationId]
    );

    if (targetOrganizationMembership.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const client = await pool.connect();
    let welcomeId = '';
    let leafIndex = 0;
    const now = new Date();

    try {
      await client.query('BEGIN');

      // Get current member count for leaf index
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM mls_group_members WHERE group_id = $1`,
        [groupId]
      );
      leafIndex = parseInt(countResult.rows[0]?.count ?? '0', 10);

      // Reserve target user's key package for this group.
      const keyPackageResult = await client.query<{ id: string }>(
        `UPDATE mls_key_packages
            SET consumed_at = NOW(), consumed_by_group_id = $1
          WHERE key_package_ref = $2
            AND user_id = $3
            AND consumed_at IS NULL
            AND EXISTS (
              SELECT 1
                FROM user_organizations
               WHERE user_id = $3
                 AND organization_id = $4
            )
        RETURNING id`,
        [
          groupId,
          payload.keyPackageRef,
          payload.userId,
          membership.organizationId
        ]
      );

      if (keyPackageResult.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Key package not available' });
        return;
      }

      // Add member
      await client.query(
        `INSERT INTO mls_group_members (
          group_id, user_id, leaf_index, role, joined_at, joined_at_epoch
        ) VALUES ($1, $2, $3, 'member', $4, $5)`,
        [groupId, payload.userId, leafIndex, now, payload.newEpoch]
      );

      // Store welcome message
      welcomeId = randomUUID();
      await client.query(
        `INSERT INTO mls_welcome_messages (
          id, group_id, recipient_user_id, key_package_ref, welcome_data, epoch, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          welcomeId,
          groupId,
          payload.userId,
          payload.keyPackageRef,
          payload.welcome,
          payload.newEpoch
        ]
      );

      // Store commit as message with atomic sequence number generation
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

    // Get member email
    const userResult = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [payload.userId]
    );

    const member: MlsGroupMember = {
      userId: payload.userId,
      email: userResult.rows[0]?.email ?? '',
      leafIndex,
      role: 'member',
      joinedAt: now.toISOString(),
      joinedAtEpoch: payload.newEpoch
    };

    // Broadcast to group channel
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:member_added',
      payload: { groupId, member },
      timestamp: now.toISOString()
    });

    // Notify new member
    await broadcast(`mls:user:${payload.userId}`, {
      type: 'mls:welcome',
      payload: { groupId, welcomeId },
      timestamp: now.toISOString()
    });

    const response: AddMlsMemberResponse = { member };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to add member:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
};

export function registerPostGroupsGroupidMembersRoute(
  routeRouter: RouterType
): void {
  routeRouter.post('/groups/:groupId/members', postGroupsGroupidMembersHandler);
}
