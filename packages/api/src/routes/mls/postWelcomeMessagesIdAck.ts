import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseAckWelcomePayload } from './shared.js';

/**
 * @openapi
 * /mls/welcome-messages/{id}/ack:
 *   post:
 *     summary: Acknowledge welcome message (mark as consumed)
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Welcome acknowledged
 */
const postWelcomeMessagesIdAckHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const idParam = req.params['id'];
  if (!idParam || typeof idParam !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const id = idParam;

  const payload = parseAckWelcomePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query(
      `UPDATE mls_welcome_messages SET consumed_at = NOW()
       WHERE id = $1
         AND recipient_user_id = $2
         AND group_id = $3
         AND EXISTS (
           SELECT 1
             FROM mls_groups g
             INNER JOIN user_organizations uo
                     ON uo.organization_id = g.organization_id
                    AND uo.user_id = $2
            WHERE g.id = $3
         )
         AND consumed_at IS NULL`,
      [id, claims.sub, payload.groupId]
    );

    if (result.rowCount === 0) {
      res
        .status(404)
        .json({ error: 'Welcome message not found or already acknowledged' });
      return;
    }

    res.json({ acknowledged: true });
  } catch (error) {
    console.error('Failed to acknowledge welcome:', error);
    res.status(500).json({ error: 'Failed to acknowledge welcome' });
  }
};

export function registerPostWelcomeMessagesIdAckRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/welcome-messages/:id/ack',
    postWelcomeMessagesIdAckHandler
  );
}
