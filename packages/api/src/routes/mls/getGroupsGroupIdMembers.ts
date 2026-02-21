import type {
  MlsGroupMember,
  MlsGroupMembersResponse
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getActiveMlsGroupMembership } from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}/members:
 *   get:
 *     summary: List MLS group members
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
 *         description: List of members
 */
const getGroupsGroupidMembersHandler = async (req: Request, res: Response) => {
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

    const members: MlsGroupMember[] = result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      leafIndex: row.leaf_index,
      role: row.role as 'admin' | 'member',
      joinedAt: row.joined_at.toISOString(),
      joinedAtEpoch: row.joined_at_epoch
    }));

    const response: MlsGroupMembersResponse = { members };
    res.json(response);
  } catch (error) {
    console.error('Failed to list members:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
};

export function registerGetGroupsGroupidMembersRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/groups/:groupId/members', getGroupsGroupidMembersHandler);
}
