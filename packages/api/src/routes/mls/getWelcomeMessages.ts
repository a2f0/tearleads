import type {
  MlsWelcomeMessage,
  MlsWelcomeMessagesResponse
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /mls/welcome-messages:
 *   get:
 *     summary: Get pending welcome messages for current user
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending welcome messages
 */
const getWelcomeMessagesHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      group_id: string;
      group_name: string;
      welcome_data: string;
      key_package_ref: string;
      epoch: number;
      created_at: Date;
    }>(
      `SELECT w.id, w.group_id, g.name as group_name, w.welcome_data, w.key_package_ref,
              w.epoch, w.created_at
       FROM mls_welcome_messages w
       JOIN mls_groups g ON w.group_id = g.id
       JOIN user_organizations uo
         ON uo.organization_id = g.organization_id
        AND uo.user_id = $1
       WHERE w.recipient_user_id = $1 AND w.consumed_at IS NULL
       ORDER BY w.created_at DESC`,
      [claims.sub]
    );

    const welcomes: MlsWelcomeMessage[] = result.rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      welcome: row.welcome_data,
      keyPackageRef: row.key_package_ref,
      epoch: row.epoch,
      createdAt: row.created_at.toISOString()
    }));

    const response: MlsWelcomeMessagesResponse = { welcomes };
    res.json(response);
  } catch (error) {
    console.error('Failed to get welcome messages:', error);
    res.status(500).json({ error: 'Failed to get welcome messages' });
  }
};

export function registerGetWelcomeMessagesRoute(routeRouter: RouterType): void {
  routeRouter.get('/welcome-messages', getWelcomeMessagesHandler);
}
