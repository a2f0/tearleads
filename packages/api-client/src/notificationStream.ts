import { type CallOptions, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v2/notifications_pb';
import {
  buildApiV2RequestHeaders,
  normalizeApiV2ConnectBaseUrl
} from './apiV2ClientWasm';
import { normalizeBearerToken } from './connectUtils';

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
  headers: Record<string, string>
): NotificationStreamCallOptions {
  if (!signal && Object.keys(headers).length === 0) {
    return {};
  }

  return {
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
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
  const [connectBaseUrl, headers] = await Promise.all([
    normalizeApiV2ConnectBaseUrl(options.apiBaseUrl),
    buildApiV2RequestHeaders({
      bearerToken: normalizeBearerToken(options.token)
    })
  ]);
  const createClient = options.createClient ?? createNotificationStreamClient;
  const client = createClient(connectBaseUrl);
  const request = { channels: options.channels };
  const stream = client.subscribe(
    request,
    toCallOptions(options.signal, headers)
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
