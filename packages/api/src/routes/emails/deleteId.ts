import { getRedisClient } from '@tearleads/shared/redis';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getEmailStorageBackend } from './backend.js';
import {
  EMAIL_DELETE_SCRIPT,
  getEmailKey,
  getEmailListKey,
  getEmailUsersKey
} from './shared.js';

/**
 * @openapi
 * /emails/{id}:
 *   delete:
 *     summary: Delete email by ID
 *     description: Deletes a single email
 *     tags:
 *       - Emails
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Email ID
 *     responses:
 *       200:
 *         description: Email deleted
 *       404:
 *         description: Email not found
 *       500:
 *         description: Server error
 */
const deleteIdHandler = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const backend = getEmailStorageBackend();

    if (backend === 'vfs') {
      const pool = await getPostgresPool();
      const deleted = await pool.query<{ id: string }>(
        `DELETE FROM vfs_registry
         WHERE id = $1
           AND owner_id = $2
           AND object_type = 'email'
         RETURNING id`,
        [id, userId]
      );
      if (!deleted.rows[0]) {
        res.status(404).json({ error: 'Email not found' });
        return;
      }
      res.json({ success: true });
      return;
    }

    const client = await getRedisClient();
    const key = getEmailKey(id);
    const usersKey = getEmailUsersKey(id);
    const hasAccess = await client.sIsMember(usersKey, userId);

    if (hasAccess !== 1) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    const result = await client.eval(EMAIL_DELETE_SCRIPT, {
      keys: [usersKey, getEmailListKey(userId), key],
      arguments: [userId, id]
    });
    if (result === 1) {
      res.json({ success: true });
      return;
    }
    res.status(404).json({ error: 'Email not found' });
  } catch (error) {
    console.error('Failed to delete email:', error);
    res.status(500).json({ error: 'Failed to delete email' });
  }
};

export function registerDeleteIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/:id', deleteIdHandler);
}
