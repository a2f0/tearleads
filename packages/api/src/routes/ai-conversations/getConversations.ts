import type { AiConversationsListResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /ai/conversations:
 *   get:
 *     summary: List user's AI conversations
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: List of conversations
 *       401:
 *         description: Unauthorized
 */
const getConversationsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query['limit']), 10) || 50),
      100
    );
    const cursor =
      typeof req.query['cursor'] === 'string' ? req.query['cursor'] : null;

    let query = `
      SELECT id, user_id, organization_id, encrypted_title, encrypted_session_key,
             model_id, message_count, created_at, updated_at
      FROM ai_conversations
      WHERE user_id = $1 AND deleted = FALSE
    `;
    const params: (string | number)[] = [claims.sub];

    if (cursor) {
      query += ' AND updated_at < $2';
      params.push(cursor);
    }

    query += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

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
    }>(query, params);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const lastRow = rows[rows.length - 1];

    const response: AiConversationsListResponse = {
      conversations: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        encryptedTitle: row.encrypted_title,
        encryptedSessionKey: row.encrypted_session_key,
        modelId: row.model_id,
        messageCount: row.message_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      })),
      hasMore,
      ...(hasMore && lastRow
        ? { cursor: lastRow.updated_at.toISOString() }
        : {})
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to list conversations:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
};

export function registerGetConversationsRoute(routeRouter: RouterType): void {
  routeRouter.get('/conversations', getConversationsHandler);
}
