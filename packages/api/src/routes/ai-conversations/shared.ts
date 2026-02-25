import type { RecordAiUsageRequest } from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import { getPostgresPool } from '../../lib/postgres.js';

export function parseRecordUsagePayload(
  body: unknown
): RecordAiUsageRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const conversationId = body['conversationId'];
  const messageId = body['messageId'];
  const modelId = body['modelId'];
  const promptTokens = body['promptTokens'];
  const completionTokens = body['completionTokens'];
  const totalTokens = body['totalTokens'];
  const openrouterRequestId = body['openrouterRequestId'];

  if (
    typeof modelId !== 'string' ||
    typeof promptTokens !== 'number' ||
    typeof completionTokens !== 'number' ||
    typeof totalTokens !== 'number'
  ) {
    return null;
  }

  if (!modelId.trim()) {
    return null;
  }

  return {
    ...(typeof conversationId === 'string' && conversationId.trim()
      ? { conversationId: conversationId.trim() }
      : {}),
    ...(typeof messageId === 'string' && messageId.trim()
      ? { messageId: messageId.trim() }
      : {}),
    modelId: modelId.trim(),
    promptTokens,
    completionTokens,
    totalTokens,
    ...(typeof openrouterRequestId === 'string' && openrouterRequestId.trim()
      ? { openrouterRequestId: openrouterRequestId.trim() }
      : {})
  };
}

export async function getUserOrganizationId(
  userId: string
): Promise<string | null> {
  const pool = await getPostgresPool();
  const result = await pool.query<{ organization_id: string }>(
    'SELECT organization_id FROM user_organizations WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.organization_id ?? null;
}
