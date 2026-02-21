import type { AiUsageSummaryResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /ai/usage/summary:
 *   get:
 *     summary: Get AI usage summary
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
 *     responses:
 *       200:
 *         description: Usage summary
 *       401:
 *         description: Unauthorized
 */
const getUsageSummaryHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const startDate =
      typeof req.query['startDate'] === 'string'
        ? req.query['startDate']
        : null;
    const endDate =
      typeof req.query['endDate'] === 'string' ? req.query['endDate'] : null;

    let whereClause = 'WHERE user_id = $1';
    const params: string[] = [claims.sub];

    if (startDate) {
      whereClause += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND created_at < $${params.length + 1}`;
      params.push(endDate);
    }

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
      ${whereClause}`,
      params
    );

    const byModelResult = await pool.query<{
      model_id: string;
      total_prompt_tokens: string;
      total_completion_tokens: string;
      total_tokens: string;
      request_count: string;
      period_start: Date | null;
      period_end: Date | null;
    }>(
      `SELECT
        model_id,
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as request_count,
        MIN(created_at) as period_start,
        MAX(created_at) as period_end
      FROM ai_usage
      ${whereClause}
      GROUP BY model_id`,
      params
    );

    const summaryRow = summaryResult.rows[0];

    const byModel: Record<
      string,
      {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalTokens: number;
        requestCount: number;
        periodStart: string;
        periodEnd: string;
      }
    > = {};

    for (const row of byModelResult.rows) {
      byModel[row.model_id] = {
        totalPromptTokens: parseInt(row.total_prompt_tokens, 10),
        totalCompletionTokens: parseInt(row.total_completion_tokens, 10),
        totalTokens: parseInt(row.total_tokens, 10),
        requestCount: parseInt(row.request_count, 10),
        periodStart:
          row.period_start?.toISOString() ?? new Date().toISOString(),
        periodEnd: row.period_end?.toISOString() ?? new Date().toISOString()
      };
    }

    const response: AiUsageSummaryResponse = {
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
      byModel
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get usage summary:', error);
    res.status(500).json({ error: 'Failed to get usage summary' });
  }
};

export function registerGetUsageSummaryRoute(routeRouter: RouterType): void {
  routeRouter.get('/usage/summary', getUsageSummaryHandler);
}
