import type {
  AddAiMessageRequest,
  AiMessageRole,
  CreateAiConversationRequest,
  RecordAiUsageRequest,
  UpdateAiConversationRequest
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import { getPostgresPool } from '../../lib/postgres.js';

const VALID_MESSAGE_ROLES: AiMessageRole[] = ['system', 'user', 'assistant'];

function isValidMessageRole(value: unknown): value is AiMessageRole {
  return (
    typeof value === 'string' &&
    VALID_MESSAGE_ROLES.some((role) => role === value)
  );
}

export function parseCreateConversationPayload(
  body: unknown
): CreateAiConversationRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const encryptedTitle = body['encryptedTitle'];
  const encryptedSessionKey = body['encryptedSessionKey'];
  const modelId = body['modelId'];

  if (
    typeof encryptedTitle !== 'string' ||
    typeof encryptedSessionKey !== 'string'
  ) {
    return null;
  }

  if (!encryptedTitle.trim() || !encryptedSessionKey.trim()) {
    return null;
  }

  return {
    encryptedTitle: encryptedTitle.trim(),
    encryptedSessionKey: encryptedSessionKey.trim(),
    ...(typeof modelId === 'string' && modelId.trim()
      ? { modelId: modelId.trim() }
      : {})
  };
}

export function parseUpdateConversationPayload(
  body: unknown
): UpdateAiConversationRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const encryptedTitle = body['encryptedTitle'];
  const modelId = body['modelId'];

  const result: UpdateAiConversationRequest = {};

  if (typeof encryptedTitle === 'string' && encryptedTitle.trim()) {
    result.encryptedTitle = encryptedTitle.trim();
  }

  if (typeof modelId === 'string') {
    const trimmed = modelId.trim();
    if (trimmed) {
      result.modelId = trimmed;
    }
  }

  if (Object.keys(result).length === 0) {
    return null;
  }

  return result;
}

export function parseAddMessagePayload(
  body: unknown
): AddAiMessageRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const role = body['role'];
  const encryptedContent = body['encryptedContent'];
  const modelId = body['modelId'];

  if (!isValidMessageRole(role) || typeof encryptedContent !== 'string') {
    return null;
  }

  if (!encryptedContent.trim()) {
    return null;
  }

  return {
    role,
    encryptedContent: encryptedContent.trim(),
    ...(typeof modelId === 'string' && modelId.trim()
      ? { modelId: modelId.trim() }
      : {})
  };
}

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
