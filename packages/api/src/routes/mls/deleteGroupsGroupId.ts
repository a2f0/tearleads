import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getActiveMlsGroupMembership } from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}:
 *   delete:
 *     summary: Leave or delete MLS group
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
 *       204:
 *         description: Left/deleted group
 */
const deleteGroupsGroupidHandler = async (req: Request, res: Response) => {
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

    // Mark as removed
    await pool.query(
      `UPDATE mls_group_members SET removed_at = NOW()
       WHERE group_id = $1 AND user_id = $2`,
      [groupId, claims.sub]
    );

    res.status(204).send();
  } catch (error) {
    console.error('Failed to leave group:', error);
    res.status(500).json({ error: 'Failed to leave group' });
  }
};

export function registerDeleteGroupsGroupidRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/groups/:groupId', deleteGroupsGroupidHandler);
}
