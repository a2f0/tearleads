import type {
  MlsGroup,
  MlsGroupMember,
  MlsGroupResponse
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getActiveMlsGroupMembership, toSafeCipherSuite } from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}:
 *   get:
 *     summary: Get MLS group details
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
 *         description: Group details with members
 */
const getGroupsGroupidHandler = async (req: Request, res: Response) => {
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

    // Get group
    const groupResult = await pool.query<{
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
      `SELECT id, group_id_mls, name, description, creator_user_id,
              current_epoch, cipher_suite, created_at, updated_at
       FROM mls_groups WHERE id = $1`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const row = groupResult.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Get members
    const membersResult = await pool.query<{
      user_id: string;
      email: string;
      leaf_index: number | null;
      role: string;
      joined_at: Date;
      joined_at_epoch: number;
    }>(
      `SELECT m.user_id, u.email, m.leaf_index, m.role, m.joined_at, m.joined_at_epoch
       FROM mls_group_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.group_id = $1 AND m.removed_at IS NULL
       ORDER BY m.joined_at ASC`,
      [groupId]
    );

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

    const members: MlsGroupMember[] = membersResult.rows.map((m) => ({
      userId: m.user_id,
      email: m.email,
      leafIndex: m.leaf_index,
      role: m.role as 'admin' | 'member',
      joinedAt: m.joined_at.toISOString(),
      joinedAtEpoch: m.joined_at_epoch
    }));

    const response: MlsGroupResponse = { group, members };
    res.json(response);
  } catch (error) {
    console.error('Failed to get group:', error);
    res.status(500).json({ error: 'Failed to get group' });
  }
};

export function registerGetGroupsGroupidRoute(routeRouter: RouterType): void {
  routeRouter.get('/groups/:groupId', getGroupsGroupidHandler);
}
