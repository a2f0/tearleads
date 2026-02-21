import type { AiConversationResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseUpdateConversationPayload } from './shared.js';

/**
 * @openapi
 * /ai/conversations/{id}:
 *   patch:
 *     summary: Update a conversation
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
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               encryptedTitle:
 *                 type: string
 *               modelId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Conversation updated
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
const patchConversationsIdHandler = async (req: Request, res: Response) => {
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

  const payload = parseUpdateConversationPayload(req.body);
  if (!payload) {
    res
      .status(400)
      .json({ error: 'At least encryptedTitle or modelId is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const updates: string[] = ['updated_at = NOW()'];
    const params: (string | null)[] = [];
    let paramIndex = 1;

    if (payload.encryptedTitle !== undefined) {
      updates.push(`encrypted_title = $${paramIndex}`);
      params.push(payload.encryptedTitle);
      paramIndex++;
    }

    if (payload.modelId !== undefined) {
      updates.push(`model_id = $${paramIndex}`);
      params.push(payload.modelId ?? null);
      paramIndex++;
    }

    const conversationId = Array.isArray(id) ? id[0] : id;
    const userId = claims.sub;
    if (!conversationId || !userId) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    params.push(conversationId);
    params.push(userId);

    const result = await pool.query<{
      id: string;
      user_id: string;
      organization_id: string | null;
      encrypted_title: string;
      encrypted_session_key: string;
      model_id: string | null;
      message_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE ai_conversations
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1} AND deleted = FALSE
       RETURNING *`,
      params
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const response: AiConversationResponse = {
      conversation: {
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        encryptedTitle: row.encrypted_title,
        encryptedSessionKey: row.encrypted_session_key,
        modelId: row.model_id,
        messageCount: row.message_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to update conversation:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
};

export function registerPatchConversationsIdRoute(
  routeRouter: RouterType
): void {
  routeRouter.patch('/conversations/:id', patchConversationsIdHandler);
}
