import { randomUUID } from 'node:crypto';
import type { CreateAiConversationResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getUserOrganizationId,
  parseCreateConversationPayload
} from './shared.js';

/**
 * @openapi
 * /ai/conversations:
 *   post:
 *     summary: Create a new AI conversation
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               encryptedTitle:
 *                 type: string
 *               encryptedSessionKey:
 *                 type: string
 *               modelId:
 *                 type: string
 *             required:
 *               - encryptedTitle
 *               - encryptedSessionKey
 *     responses:
 *       201:
 *         description: Conversation created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
const postConversationsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseCreateConversationPayload(req.body);
  if (!payload) {
    res.status(400).json({
      error: 'encryptedTitle and encryptedSessionKey are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const orgId = await getUserOrganizationId(claims.sub);
    const id = randomUUID();
    const now = new Date();

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
      `INSERT INTO ai_conversations (
        id, user_id, organization_id, encrypted_title, encrypted_session_key,
        model_id, message_count, created_at, updated_at, deleted
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7, FALSE)
      RETURNING *`,
      [
        id,
        claims.sub,
        orgId,
        payload.encryptedTitle,
        payload.encryptedSessionKey,
        payload.modelId ?? null,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Failed to create conversation' });
      return;
    }

    const response: CreateAiConversationResponse = {
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

    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to create conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

export function registerPostConversationsRoute(routeRouter: RouterType): void {
  routeRouter.post('/conversations', postConversationsHandler);
}
