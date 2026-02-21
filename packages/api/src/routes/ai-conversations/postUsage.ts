import { randomUUID } from 'node:crypto';
import type { RecordAiUsageResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getUserOrganizationId, parseRecordUsagePayload } from './shared.js';

/**
 * @openapi
 * /ai/usage:
 *   post:
 *     summary: Record AI usage
 *     tags:
 *       - AI Usage
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId:
 *                 type: string
 *               messageId:
 *                 type: string
 *               modelId:
 *                 type: string
 *               promptTokens:
 *                 type: integer
 *               completionTokens:
 *                 type: integer
 *               totalTokens:
 *                 type: integer
 *               openrouterRequestId:
 *                 type: string
 *             required:
 *               - modelId
 *               - promptTokens
 *               - completionTokens
 *               - totalTokens
 *     responses:
 *       201:
 *         description: Usage recorded
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
const postUsageHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseRecordUsagePayload(req.body);
  if (!payload) {
    res.status(400).json({
      error:
        'modelId, promptTokens, completionTokens, and totalTokens are required'
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
      conversation_id: string | null;
      message_id: string | null;
      user_id: string;
      organization_id: string | null;
      model_id: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      openrouter_request_id: string | null;
      created_at: Date;
    }>(
      `INSERT INTO ai_usage (
        id, conversation_id, message_id, user_id, organization_id,
        model_id, prompt_tokens, completion_tokens, total_tokens,
        openrouter_request_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id,
        payload.conversationId ?? null,
        payload.messageId ?? null,
        claims.sub,
        orgId,
        payload.modelId,
        payload.promptTokens,
        payload.completionTokens,
        payload.totalTokens,
        payload.openrouterRequestId ?? null,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Failed to record usage' });
      return;
    }

    const response: RecordAiUsageResponse = {
      usage: {
        id: row.id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        userId: row.user_id,
        organizationId: row.organization_id,
        modelId: row.model_id,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        openrouterRequestId: row.openrouter_request_id,
        createdAt: row.created_at.toISOString()
      }
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to record usage:', error);
    res.status(500).json({ error: 'Failed to record usage' });
  }
};

export function registerPostUsageRoute(routeRouter: RouterType): void {
  routeRouter.post('/usage', postUsageHandler);
}
