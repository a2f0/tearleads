import { type CallOptions, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v1/notifications_pb';

type NotificationStreamCallOptions = Pick<CallOptions, 'headers' | 'signal'>;

interface NotificationStreamResponse {
  json: string;
}

interface NotificationStreamClient {
  subscribe(
    request: { channels: string[] },
    options?: NotificationStreamCallOptions
  ): AsyncIterable<NotificationStreamResponse>;
}

type NotificationStreamClientFactory = (
  connectBaseUrl: string
) => NotificationStreamClient;

interface OpenNotificationEventStreamOptions {
  apiBaseUrl: string;
  channels: string[];
  token?: string | null;
  signal?: AbortSignal;
  createClient?: NotificationStreamClientFactory;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error('apiBaseUrl is required');
  }

  if (trimmed.endsWith('/')) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function toConnectBaseUrl(apiBaseUrl: string): string {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (normalizedApiBaseUrl.endsWith('/connect')) {
    return normalizedApiBaseUrl;
  }
  return `${normalizedApiBaseUrl}/connect`;
}

function normalizeToken(token: string | null | undefined): string | null {
  if (!token) {
    return null;
  }
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!trimmed.startsWith('Bearer ')) {
    return trimmed;
  }
  const withoutPrefix = trimmed.slice('Bearer '.length).trim();
  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

function createNotificationStreamClient(
  connectBaseUrl: string
): NotificationStreamClient {
  return createClient(
    NotificationService,
    createConnectTransport({ baseUrl: connectBaseUrl })
  );
}

function toCallOptions(
  signal: AbortSignal | undefined,
  token: string | null
): NotificationStreamCallOptions {
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

function readResponsePayload(
  response: NotificationStreamResponse
): string | null {
  const payload = response.json.trim();
  if (payload.length === 0) {
    return null;
  }
  return response.json;
}

export async function* openNotificationEventStream(
  options: OpenNotificationEventStreamOptions
): AsyncGenerator<string> {
  const connectBaseUrl = toConnectBaseUrl(options.apiBaseUrl);
  const createClient = options.createClient ?? createNotificationStreamClient;
  const token = normalizeToken(options.token);
  const client = createClient(connectBaseUrl);
  const request = { channels: options.channels };
  const stream = client.subscribe(
    request,
    toCallOptions(options.signal, token)
  );

  for await (const response of stream) {
    const payload = readResponsePayload(response);
    if (!payload) {
      continue;
    }
    yield payload;
  }
}
