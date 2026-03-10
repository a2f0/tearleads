import { type CallOptions, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { ChatService } from '@tearleads/shared/gen/tearleads/v2/chat_pb';
import { normalizeBearerToken, toConnectBaseUrl } from './connectUtils';

type ChatCompletionsCallOptions = Pick<CallOptions, 'headers' | 'signal'>;

interface ChatCompletionsResponse {
  json: string;
}

interface ChatCompletionsClient {
  postCompletions(
    request: { json: string },
    options?: ChatCompletionsCallOptions
  ): Promise<ChatCompletionsResponse>;
}

type ChatCompletionsClientFactory = (
  connectBaseUrl: string
) => ChatCompletionsClient;

interface OpenChatCompletionsOptions {
  apiBaseUrl: string;
  body: unknown;
  token?: string | null;
  signal?: AbortSignal;
  createClient?: ChatCompletionsClientFactory;
}

function createChatCompletionsClient(
  connectBaseUrl: string
): ChatCompletionsClient {
  return createClient(
    ChatService,
    createConnectTransport({ baseUrl: connectBaseUrl })
  );
}

function toCallOptions(
  signal: AbortSignal | undefined,
  token: string | null
): ChatCompletionsCallOptions {
  if (!signal && !token) {
    return {};
  }

  const headers: HeadersInit | undefined = token
    ? { Authorization: `Bearer ${token}` }
    : undefined;

  return {
    ...(headers ? { headers } : {}),
    ...(signal ? { signal } : {})
  };
}

function toRequestJson(body: unknown): string {
  const serialized = JSON.stringify(body ?? {});
  return typeof serialized === 'string' ? serialized : '{}';
}

function parseResponseJson(responseJson: string): unknown {
  const trimmed = responseJson.trim();
  if (trimmed.length === 0) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('Chat completions response was not valid JSON');
  }
}

export async function openChatCompletions(
  options: OpenChatCompletionsOptions
): Promise<unknown> {
  const connectBaseUrl = toConnectBaseUrl(options.apiBaseUrl);
  const createClient = options.createClient ?? createChatCompletionsClient;
  const token = normalizeBearerToken(options.token);
  const client = createClient(connectBaseUrl);

  const response = await client.postCompletions(
    {
      json: toRequestJson(options.body)
    },
    toCallOptions(options.signal, token)
  );

  return parseResponseJson(response.json);
}
