import {
  type CallOptions,
  createClient
} from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v1/notifications_pb';
import { normalizeBearerToken, toConnectBaseUrl } from './connectUtils';

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
  const token = normalizeBearerToken(options.token);
  const client = createClient(connectBaseUrl);
  const request = { channels: options.channels };
  const stream = client.subscribe(
    request,
    toCallOptions(options.signal, token)
  );

  try {
    for await (const response of stream) {
      const payload = readResponsePayload(response);
      if (!payload) {
        continue;
      }
      yield payload;
    }
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }
    throw error;
  }
}
