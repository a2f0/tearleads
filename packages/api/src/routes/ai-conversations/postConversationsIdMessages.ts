import { randomUUID } from 'node:crypto';
import type { AddAiMessageResponse, AiMessageRole } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseAddMessagePayload } from './shared.js';

/**
 * @openapi
 * /ai/conversations/{id}/messages:
 *   post:
 *     summary: Add a message to a conversation
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [system, user, assistant]
 *               encryptedContent:
 *                 type: string
 *               modelId:
 *                 type: string
 *             required:
 *               - role
 *               - encryptedContent
 *     responses:
 *       201:
 *         description: Message added
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
const postConversationsIdMessagesHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id: conversationId } = req.params;
  if (!conversationId) {
    res.status(400).json({ error: 'Conversation ID is required' });
    return;
  }

  const payload = parseAddMessagePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'role and encryptedContent are required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const convCheck = await pool.query<{ id: string; message_count: number }>(
      'SELECT id, message_count FROM ai_conversations WHERE id = $1 AND user_id = $2 AND deleted = FALSE',
      [conversationId, claims.sub]
    );

    if (convCheck.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const currentCount = convCheck.rows[0]?.message_count ?? 0;
    const messageId = randomUUID();
    const now = new Date();

    await pool.query('BEGIN');

    try {
      const msgResult = await pool.query<{
        id: string;
        conversation_id: string;
        role: AiMessageRole;
        encrypted_content: string;
        model_id: string | null;
        sequence_number: number;
        created_at: Date;
      }>(
        `INSERT INTO ai_messages (id, conversation_id, role, encrypted_content, model_id, sequence_number, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          messageId,
          conversationId,
          payload.role,
          payload.encryptedContent,
          payload.modelId ?? null,
          currentCount + 1,
          now
        ]
      );

      const convResult = await pool.query<{
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
         SET message_count = message_count + 1, updated_at = $1
         WHERE id = $2
         RETURNING *`,
        [now, conversationId]
      );

      await pool.query('COMMIT');

      const msg = msgResult.rows[0];
      const conv = convResult.rows[0];

      if (!msg || !conv) {
        res.status(500).json({ error: 'Failed to add message' });
        return;
      }

      const response: AddAiMessageResponse = {
        message: {
          id: msg.id,
          conversationId: msg.conversation_id,
          role: msg.role,
          encryptedContent: msg.encrypted_content,
          modelId: msg.model_id,
          sequenceNumber: msg.sequence_number,
          createdAt: msg.created_at.toISOString()
        },
        conversation: {
          id: conv.id,
          userId: conv.user_id,
          organizationId: conv.organization_id,
          encryptedTitle: conv.encrypted_title,
          encryptedSessionKey: conv.encrypted_session_key,
          modelId: conv.model_id,
          messageCount: conv.message_count,
          createdAt: conv.created_at.toISOString(),
          updatedAt: conv.updated_at.toISOString()
        }
      };

      res.status(201).json(response);
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (error) {
    console.error('Failed to add message:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
};

export function registerPostConversationsIdMessagesRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/conversations/:id/messages',
    postConversationsIdMessagesHandler
  );
}
