import {
  type CallOptions,
  type Client,
  createClient
} from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import { MlsService } from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import { API_BASE_URL } from '../apiCore';
import { type ApiEventSlug, logApiEvent } from '../apiLogger';
import {
  type ApiV2RequestHeaderOptions,
  buildApiV2RequestHeaders,
  normalizeApiV2ConnectBaseUrl
} from '../apiV2ClientWasm';
import { getAuthHeaderValue } from '../authStorage';

export type MlsV2CallOptions = Pick<CallOptions, 'headers'>;

export type MlsV2Client = Client<typeof MlsService>;

export interface MlsV2RoutesDependencies {
  resolveApiBaseUrl: () => string;
  normalizeConnectBaseUrl: (apiBaseUrl: string) => Promise<string>;
  buildHeaders: (
    options: ApiV2RequestHeaderOptions
  ) => Promise<Record<string, string>>;
  getAuthHeaderValue: () => string | null;
  createClient: (connectBaseUrl: string) => MlsV2Client;
  logEvent: (
    eventName: ApiEventSlug,
    durationMs: number,
    success: boolean
  ) => Promise<void>;
}

export function createDefaultDependencies(): MlsV2RoutesDependencies {
  return {
    resolveApiBaseUrl: () => {
      if (!API_BASE_URL) {
        throw new Error('VITE_API_URL environment variable is not set');
      }
      return API_BASE_URL;
    },
    normalizeConnectBaseUrl: normalizeApiV2ConnectBaseUrl,
    buildHeaders: buildApiV2RequestHeaders,
    getAuthHeaderValue,
    createClient: createDefaultMlsV2Client,
    logEvent: logApiEvent
  };
}

function toCallOptions(headers: Record<string, string>): MlsV2CallOptions {
  if (Object.keys(headers).length === 0) {
    return {};
  }

  return { headers };
}

export function createClientResolver(
  dependencies: MlsV2RoutesDependencies
): () => Promise<MlsV2Client> {
  let pendingClient: Promise<MlsV2Client> | null = null;

  return async () => {
    if (pendingClient) {
      return pendingClient;
    }

    const unresolvedClient = (async () => {
      const connectBaseUrl = await dependencies.normalizeConnectBaseUrl(
        dependencies.resolveApiBaseUrl()
      );
      return dependencies.createClient(connectBaseUrl);
    })();

    pendingClient = unresolvedClient.catch((error: unknown) => {
      pendingClient = null;
      throw error;
    });

    return pendingClient;
  };
}

export async function buildCallContext(
  dependencies: MlsV2RoutesDependencies,
  getClient: () => Promise<MlsV2Client>
): Promise<{ client: MlsV2Client; callOptions: MlsV2CallOptions }> {
  const client = await getClient();
  const headers = await dependencies.buildHeaders({
    bearerToken: dependencies.getAuthHeaderValue()
  });

  return {
    client,
    callOptions: toCallOptions(headers)
  };
}

export async function runWithEvent<T>(
  dependencies: MlsV2RoutesDependencies,
  eventName: ApiEventSlug,
  operation: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  let success = false;

  try {
    const response = await operation();
    success = true;
    return response;
  } finally {
    await dependencies.logEvent(eventName, performance.now() - start, success);
  }
}

export function createDefaultMlsV2Client(
  connectBaseUrl: string
): MlsV2Client {
  const transport = createGrpcWebTransport({
    baseUrl: connectBaseUrl,
    useBinaryFormat: true
  });

  return createClient(MlsService, transport);
}
