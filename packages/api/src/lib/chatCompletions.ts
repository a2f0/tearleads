// COMPLIANCE_SENTINEL: TL-VENDOR-007 | control=openrouter-vendor
import { randomUUID } from 'node:crypto';
import {
  type ChatMessage,
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord,
  validateChatMessages
} from '@tearleads/shared';
import { getPostgresPool } from './postgres.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

type ParsedChatCompletionPayload = {
  messages: ChatMessage[];
  modelId: string;
};

type UsagePayload = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  openrouterRequestId: string | null;
};

type ParseFailure = {
  error: string;
};

type RecordUsageInput = {
  modelId: string;
  authUserId: string;
  usagePayload: UsagePayload;
};

type ChatCompletionsResult = {
  status: number;
  payload: unknown;
};

function parseChatCompletionsBody(
  body: unknown
): ParsedChatCompletionPayload | ParseFailure {
  const messagesValue = isRecord(body) ? body['messages'] : undefined;
  const messageResult = validateChatMessages(messagesValue);
  if (!messageResult.ok) {
    return { error: messageResult.error };
  }

  let modelId = DEFAULT_OPENROUTER_MODEL_ID;
  if (isRecord(body) && body['model'] !== undefined) {
    const modelValue = body['model'];
    if (typeof modelValue !== 'string' || !isOpenRouterModelId(modelValue)) {
      return { error: 'model must be a supported OpenRouter chat model' };
    }
    modelId = modelValue;
  }

  return {
    messages: messageResult.messages,
    modelId
  };
}

function parseOpenRouterResponsePayload(responseText: string): unknown {
  if (responseText.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { error: responseText };
  }
}

function extractUsagePayload(payload: unknown): UsagePayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const usageValue = payload['usage'];
  if (!isRecord(usageValue)) {
    return null;
  }

  const promptTokens =
    typeof usageValue['prompt_tokens'] === 'number'
      ? usageValue['prompt_tokens']
      : 0;
  const completionTokens =
    typeof usageValue['completion_tokens'] === 'number'
      ? usageValue['completion_tokens']
      : 0;
  const totalTokens =
    typeof usageValue['total_tokens'] === 'number'
      ? usageValue['total_tokens']
      : promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    openrouterRequestId:
      typeof payload['id'] === 'string' ? payload['id'] : null
  };
}

async function recordUsage(input: RecordUsageInput): Promise<void> {
  const { authUserId, modelId, usagePayload } = input;
  try {
    const pool = await getPostgresPool();
    const orgResult = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM user_organizations WHERE user_id = $1 LIMIT 1',
      [authUserId]
    );
    const organizationId = orgResult.rows[0]?.organization_id ?? null;

    void pool
      .query(
        `INSERT INTO ai_usage (
          id, user_id, organization_id, model_id,
          prompt_tokens, completion_tokens, total_tokens,
          openrouter_request_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          randomUUID(),
          authUserId,
          organizationId,
          modelId,
          usagePayload.promptTokens,
          usagePayload.completionTokens,
          usagePayload.totalTokens,
          usagePayload.openrouterRequestId
        ]
      )
      .catch((error) => {
        console.error('Failed to record AI usage:', error);
      });
  } catch (error) {
    console.error('Failed to get user org for usage tracking:', error);
  }
}

export async function createChatCompletion(options: {
  body: unknown;
  authUserId?: string;
}): Promise<ChatCompletionsResult> {
  const parsedPayload = parseChatCompletionsBody(options.body);
  if ('error' in parsedPayload) {
    return {
      status: 400,
      payload: { error: parsedPayload.error }
    };
  }

  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    return {
      status: 500,
      payload: { error: 'OPENROUTER_API_KEY is not configured on the server' }
    };
  }

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: parsedPayload.modelId,
        messages: parsedPayload.messages
      })
    });

    const responseText = await response.text();
    const payload = parseOpenRouterResponsePayload(responseText);

    const usagePayload = extractUsagePayload(payload);
    if (response.ok && usagePayload && options.authUserId) {
      void recordUsage({
        authUserId: options.authUserId,
        modelId: parsedPayload.modelId,
        usagePayload
      });
    }

    return {
      status: response.status,
      payload
    };
  } catch (error) {
    console.error('OpenRouter request failed:', error);
    return {
      status: 502,
      payload: { error: 'Failed to contact OpenRouter' }
    };
  }
}
