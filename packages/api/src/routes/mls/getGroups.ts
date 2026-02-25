import type { MlsGroup, MlsGroupsResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';
import { toSafeCipherSuite } from './shared.js';

/**
 * @openapi
 * /mls/groups:
 *   get:
 *     summary: List user's MLS groups
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of groups
 */
const getGroupsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPool('read');
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
      role: string;
      member_count: string;
    }>(
      `SELECT g.id, g.group_id_mls, g.name, g.description, g.creator_user_id,
              g.current_epoch, g.cipher_suite, g.created_at, g.updated_at,
              m.role,
              (SELECT COUNT(*) FROM mls_group_members WHERE group_id = g.id AND removed_at IS NULL)::text as member_count
       FROM mls_groups g
       JOIN mls_group_members m ON g.id = m.group_id
       JOIN user_organizations uo
         ON uo.user_id = m.user_id
        AND uo.organization_id = g.organization_id
       WHERE m.user_id = $1 AND m.removed_at IS NULL
       ORDER BY g.updated_at DESC`,
      [claims.sub]
    );

    const groups: MlsGroup[] = result.rows.map((row) => ({
      id: row.id,
      groupIdMls: row.group_id_mls,
      name: row.name,
      description: row.description,
      creatorUserId: row.creator_user_id,
      currentEpoch: row.current_epoch,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      memberCount: parseInt(row.member_count, 10),
      role: row.role as 'admin' | 'member'
    }));

    const response: MlsGroupsResponse = { groups };
    res.json(response);
  } catch (error) {
    console.error('Failed to list groups:', error);
    res.status(500).json({ error: 'Failed to list groups' });
  }
};

export function registerGetGroupsRoute(routeRouter: RouterType): void {
  routeRouter.get('/groups', getGroupsHandler);
}
