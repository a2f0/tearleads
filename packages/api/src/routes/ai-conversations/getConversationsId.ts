import type {
  AiConversationDetailResponse,
  AiMessageRole
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /ai/conversations/{id}:
 *   get:
 *     summary: Get a conversation with its messages
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
 *       200:
 *         description: Conversation with messages
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
const getConversationsIdHandler = async (req: Request, res: Response) => {
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
    const pool = await getPool('read');

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
      `SELECT id, user_id, organization_id, encrypted_title, encrypted_session_key,
              model_id, message_count, created_at, updated_at
       FROM ai_conversations
       WHERE id = $1 AND user_id = $2 AND deleted = FALSE`,
      [id, claims.sub]
    );

    const conv = convResult.rows[0];
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const msgResult = await pool.query<{
      id: string;
      conversation_id: string;
      role: AiMessageRole;
      encrypted_content: string;
      model_id: string | null;
      sequence_number: number;
      created_at: Date;
    }>(
      `SELECT id, conversation_id, role, encrypted_content, model_id, sequence_number, created_at
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY sequence_number ASC`,
      [id]
    );

    const response: AiConversationDetailResponse = {
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
      },
      messages: msgResult.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        encryptedContent: row.encrypted_content,
        modelId: row.model_id,
        sequenceNumber: row.sequence_number,
        createdAt: row.created_at.toISOString()
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};

export function registerGetConversationsIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/conversations/:id', getConversationsIdHandler);
}
