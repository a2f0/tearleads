import type { PendingWelcome, PendingWelcomesResponse } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

const router: RouterType = Router();

/**
 * @openapi
 * /mls/welcomes:
 *   get:
 *     summary: Get pending Welcome messages
 *     description: Returns unfetched Welcome messages for the authenticated user.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending Welcome messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 welcomes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       groupId:
 *                         type: string
 *                       groupName:
 *                         type: string
 *                       welcomeData:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const result = await pool.query<{
      id: string;
      group_id: string;
      group_name: string;
      welcome_data: string;
      created_at: Date;
    }>(
      `SELECT w.id, w.group_id, g.name as group_name, w.welcome_data, w.created_at
       FROM mls_welcomes w
       JOIN chat_groups g ON w.group_id = g.id
       WHERE w.recipient_user_id = $1 AND w.fetched = FALSE
       ORDER BY w.created_at ASC`,
      [claims.sub]
    );

    const welcomes: PendingWelcome[] = result.rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      welcomeData: row.welcome_data,
      createdAt: row.created_at.toISOString()
    }));

    const response: PendingWelcomesResponse = { welcomes };
    res.json(response);
  } catch (error) {
    console.error('Failed to get Welcome messages:', error);
    res.status(500).json({ error: 'Failed to get Welcome messages' });
  }
});

/**
 * @openapi
 * /mls/welcomes/{welcomeId}/ack:
 *   post:
 *     summary: Acknowledge Welcome message
 *     description: Marks a Welcome message as fetched/processed.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: welcomeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Welcome acknowledged
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Welcome not found
 */
router.post('/:welcomeId/ack', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { welcomeId } = req.params;

  try {
    const pool = await getPostgresPool();

    const result = await pool.query(
      `UPDATE mls_welcomes
       SET fetched = TRUE
       WHERE id = $1 AND recipient_user_id = $2`,
      [welcomeId, claims.sub]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Welcome not found' });
      return;
    }

    res.json({ acknowledged: true });
  } catch (error) {
    console.error('Failed to acknowledge Welcome:', error);
    res.status(500).json({ error: 'Failed to acknowledge Welcome' });
  }
});

export { router as welcomesRouter };
