import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { getPool, getPostgresPool } from '../../lib/postgres.js';

const DEFAULT_USAGE_LIMIT = 50;
const MAX_USAGE_LIMIT = 100;

type UsageRow = {
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
};

type UsageSummaryRow = {
  total_prompt_tokens: string;
  total_completion_tokens: string;
  total_tokens: string;
  request_count: string;
  period_start: Date | null;
  period_end: Date | null;
};

type UsageSummaryByModelRow = UsageSummaryRow & {
  model_id: string;
};

export interface AiRecordUsageRequestLike {
  conversationId: string;
  messageId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  openrouterRequestId: string;
}

export interface AiGetUsageRequestLike {
  startDate: string;
  endDate: string;
  cursor: string;
  limit: number;
}

export interface AiGetUsageSummaryRequestLike {
  startDate: string;
  endDate: string;
}

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUsageSummary(row: UsageSummaryRow | undefined) {
  const nowIso = new Date().toISOString();
  return {
    totalPromptTokens: parseCount(row?.total_prompt_tokens),
    totalCompletionTokens: parseCount(row?.total_completion_tokens),
    totalTokens: parseCount(row?.total_tokens),
    requestCount: parseCount(row?.request_count),
    periodStart: row?.period_start?.toISOString() ?? nowIso,
    periodEnd: row?.period_end?.toISOString() ?? nowIso
  };
}

function toUsage(row: UsageRow) {
  return {
    id: row.id,
    userId: row.user_id,
    modelId: row.model_id,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    createdAt: row.created_at.toISOString(),
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    ...(row.organization_id ? { organizationId: row.organization_id } : {}),
    ...(row.openrouter_request_id
      ? { openrouterRequestId: row.openrouter_request_id }
      : {})
  };
}

function normalizeUsageLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_USAGE_LIMIT;
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_USAGE_LIMIT);
}

async function getUserOrganizationId(userId: string): Promise<string | null> {
  const pool = await getPostgresPool();
  const result = await pool.query<{ organization_id: string }>(
    'SELECT organization_id FROM user_organizations WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.organization_id ?? null;
}

export async function recordUsageForUser(
  userId: string,
  request: AiRecordUsageRequestLike
) {
  const modelId = normalizeOptionalString(request.modelId);
  if (!modelId) {
    throw new ConnectError(
      'modelId, promptTokens, completionTokens, and totalTokens are required',
      Code.InvalidArgument
    );
  }

  const conversationId = normalizeOptionalString(request.conversationId);
  const messageId = normalizeOptionalString(request.messageId);
  const openrouterRequestId = normalizeOptionalString(
    request.openrouterRequestId
  );

  try {
    const pool = await getPostgresPool();
    const organizationId = await getUserOrganizationId(userId);
    const id = randomUUID();
    const now = new Date();

    const result = await pool.query<UsageRow>(
      `INSERT INTO ai_usage (
        id, conversation_id, message_id, user_id, organization_id,
        model_id, prompt_tokens, completion_tokens, total_tokens,
        openrouter_request_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id,
        conversationId ?? null,
        messageId ?? null,
        userId,
        organizationId,
        modelId,
        request.promptTokens,
        request.completionTokens,
        request.totalTokens,
        openrouterRequestId ?? null,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Failed to record usage', Code.Internal);
    }

    return {
      usage: toUsage(row)
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to record usage:', error);
    throw new ConnectError('Failed to record usage', Code.Internal);
  }
}

export async function getUsageForUser(
  userId: string,
  request: AiGetUsageRequestLike
) {
  try {
    const pool = await getPool('read');
    const limit = normalizeUsageLimit(request.limit);
    const cursor = normalizeOptionalString(request.cursor);
    const startDate = normalizeOptionalString(request.startDate);
    const endDate = normalizeOptionalString(request.endDate);

    let query = `
      SELECT id, conversation_id, message_id, user_id, organization_id,
             model_id, prompt_tokens, completion_tokens, total_tokens,
             openrouter_request_id, created_at
      FROM ai_usage
      WHERE user_id = $1
    `;
    const params: (string | number)[] = [userId];

    if (startDate) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at < $${params.length + 1}`;
      params.push(endDate);
    }

    if (cursor) {
      query += ` AND created_at < $${params.length + 1}`;
      params.push(cursor);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const usageResult = await pool.query<UsageRow>(query, params);
    const hasMore = usageResult.rows.length > limit;
    const rows = hasMore ? usageResult.rows.slice(0, limit) : usageResult.rows;
    const lastRow = rows[rows.length - 1];

    const summaryResult = await pool.query<UsageSummaryRow>(
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
        ? [userId, startDate, endDate]
        : startDate
          ? [userId, startDate]
          : endDate
            ? [userId, endDate]
            : [userId]
    );

    return {
      usage: rows.map(toUsage),
      summary: toUsageSummary(summaryResult.rows[0]),
      hasMore,
      ...(hasMore && lastRow
        ? { cursor: lastRow.created_at.toISOString() }
        : {})
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get usage:', error);
    throw new ConnectError('Failed to get usage', Code.Internal);
  }
}

export async function getUsageSummaryForUser(
  userId: string,
  request: AiGetUsageSummaryRequestLike
) {
  try {
    const pool = await getPool('read');
    const startDate = normalizeOptionalString(request.startDate);
    const endDate = normalizeOptionalString(request.endDate);

    let whereClause = 'WHERE user_id = $1';
    const params: string[] = [userId];

    if (startDate) {
      whereClause += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND created_at < $${params.length + 1}`;
      params.push(endDate);
    }

    const summaryResult = await pool.query<UsageSummaryRow>(
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

    const byModelResult = await pool.query<UsageSummaryByModelRow>(
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

    const byModel: Record<string, ReturnType<typeof toUsageSummary>> = {};
    for (const row of byModelResult.rows) {
      byModel[row.model_id] = toUsageSummary(row);
    }

    return {
      summary: toUsageSummary(summaryResult.rows[0]),
      byModel
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get usage summary:', error);
    throw new ConnectError('Failed to get usage summary', Code.Internal);
  }
}
