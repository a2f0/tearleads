import type { AiUsageListResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /ai/usage:
 *   get:
 *     summary: Get AI usage history
 *     tags:
 *       - AI Usage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
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
 *         description: Usage history
 *       401:
 *         description: Unauthorized
 */
const getUsageHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPool('read');
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query['limit']), 10) || 50),
      100
    );
    const cursor =
      typeof req.query['cursor'] === 'string' ? req.query['cursor'] : null;
    const startDate =
      typeof req.query['startDate'] === 'string'
        ? req.query['startDate']
        : null;
    const endDate =
      typeof req.query['endDate'] === 'string' ? req.query['endDate'] : null;

    let query = `
      SELECT id, conversation_id, message_id, user_id, organization_id,
             model_id, prompt_tokens, completion_tokens, total_tokens,
             openrouter_request_id, created_at
      FROM ai_usage
      WHERE user_id = $1
    `;
    const params: (string | number)[] = [claims.sub];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND created_at < $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    if (cursor) {
      query += ` AND created_at < $${paramIndex}`;
      params.push(cursor);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit + 1);

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
    }>(query, params);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const lastRow = rows[rows.length - 1];

    const summaryResult = await pool.query<{
      total_prompt_tokens: string;
      total_completion_tokens: string;
      total_tokens: string;
      request_count: string;
      period_start: Date | null;
      period_end: Date | null;
    }>(
      `SELECT
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as request_count,
        MIN(created_at) as period_start,
        MAX(created_at) as period_end
      FROM ai_usage
      WHERE user_id = $1
        ${startDate ? 'AND created_at >= $2' : ''}
        ${endDate ? `AND created_at < $${startDate ? 3 : 2}` : ''}`,
      startDate && endDate
        ? [claims.sub, startDate, endDate]
        : startDate
          ? [claims.sub, startDate]
          : endDate
            ? [claims.sub, endDate]
            : [claims.sub]
    );

    const summaryRow = summaryResult.rows[0];

    const response: AiUsageListResponse = {
      usage: rows.map((row) => ({
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
      })),
      summary: {
        totalPromptTokens: parseInt(summaryRow?.total_prompt_tokens ?? '0', 10),
        totalCompletionTokens: parseInt(
          summaryRow?.total_completion_tokens ?? '0',
          10
        ),
        totalTokens: parseInt(summaryRow?.total_tokens ?? '0', 10),
        requestCount: parseInt(summaryRow?.request_count ?? '0', 10),
        periodStart:
          summaryRow?.period_start?.toISOString() ?? new Date().toISOString(),
        periodEnd:
          summaryRow?.period_end?.toISOString() ?? new Date().toISOString()
      },
      hasMore,
      ...(hasMore && lastRow
        ? { cursor: lastRow.created_at.toISOString() }
        : {})
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get usage:', error);
    res.status(500).json({ error: 'Failed to get usage' });
  }
};

export function registerGetUsageRoute(routeRouter: RouterType): void {
  routeRouter.get('/usage', getUsageHandler);
}
