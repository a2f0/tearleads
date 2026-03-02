import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v1/notifications_connect';
import type { SubscribeResponse } from '@tearleads/shared/gen/tearleads/v1/notifications_pb';
import { SubscribeRequest } from '@tearleads/shared/gen/tearleads/v1/notifications_pb';

interface NotificationStreamCallOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
}

interface NotificationStreamClient {
  subscribe(
    request: SubscribeRequest,
    options?: NotificationStreamCallOptions
  ): AsyncIterable<SubscribeResponse>;
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
  return createPromiseClient(
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

function readResponsePayload(response: SubscribeResponse): string | null {
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
  const request = new SubscribeRequest({ channels: options.channels });
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
