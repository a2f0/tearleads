import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /ai/conversations/{id}:
 *   delete:
 *     summary: Soft delete a conversation
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Conversation deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
const deleteConversationsIdHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Conversation ID is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const result = await pool.query(
      `UPDATE ai_conversations
       SET deleted = TRUE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND deleted = FALSE`,
      [id, claims.sub]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
};

export function registerDeleteConversationsIdRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/conversations/:id', deleteConversationsIdHandler);
}
