import { create } from '@bufbuild/protobuf';
import {
  type CallOptions,
  type Client,
  Code,
  ConnectError,
  createClient
} from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import type {
  AiUsage,
  AiUsageListResponse,
  AiUsageSummary,
  AiUsageSummaryResponse,
  RecordAiUsageRequest,
  RecordAiUsageResponse
} from '@tearleads/shared';
import {
  AiServiceGetUsageRequestSchema,
  type AiServiceGetUsageResponse,
  AiServiceGetUsageSummaryRequestSchema,
  type AiServiceGetUsageSummaryResponse,
  AiService
} from '@tearleads/shared/gen/tearleads/v2/ai_pb';
import { getAuthHeaderValue } from '../authStorage';
import {
  API_BASE_URL,
  request,
  tryRefreshToken
} from '../apiCore';
import { type ApiEventSlug, logApiEvent } from '../apiLogger';
import {
  type ApiV2RequestHeaderOptions,
  buildApiV2RequestHeaders,
  normalizeApiV2ConnectBaseUrl
} from '../apiV2ClientWasm';

const AI_V1_CONNECT_BASE_PATH = '/connect/tearleads.v1.AiService';

type AiV2CallOptions = Pick<CallOptions, 'headers'>;

export type AiV2Client = Client<typeof AiService>;

export interface AiRoutesDependencies {
  resolveApiBaseUrl: () => string;
  normalizeConnectBaseUrl: (apiBaseUrl: string) => Promise<string>;
  buildHeaders: (
    options: ApiV2RequestHeaderOptions
  ) => Promise<Record<string, string>>;
  getAuthHeaderValue: () => string | null;
  createClient: (connectBaseUrl: string) => AiV2Client;
  refreshOnUnauthenticated: () => Promise<boolean>;
  logEvent: (
    eventName: ApiEventSlug,
    durationMs: number,
    success: boolean
  ) => Promise<void>;
}

function createDefaultDependencies(): AiRoutesDependencies {
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
    createClient: createDefaultAiV2Client,
    refreshOnUnauthenticated: tryRefreshToken,
    logEvent: logApiEvent
  };
}

function toCallOptions(headers: Record<string, string>): AiV2CallOptions {
  if (Object.keys(headers).length === 0) {
    return {};
  }
  return { headers };
}

export function createDefaultAiV2Client(connectBaseUrl: string): AiV2Client {
  const transport = createGrpcWebTransport({
    baseUrl: connectBaseUrl,
    useBinaryFormat: true
  });
  return createClient(AiService, transport);
}

function createClientResolver(
  dependencies: AiRoutesDependencies
): () => Promise<AiV2Client> {
  let pendingClient: Promise<AiV2Client> | null = null;

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

async function buildCallContext(
  dependencies: AiRoutesDependencies,
  getClient: () => Promise<AiV2Client>
): Promise<{ client: AiV2Client; callOptions: AiV2CallOptions }> {
  const client = await getClient();
  const headers = await dependencies.buildHeaders({
    bearerToken: dependencies.getAuthHeaderValue()
  });

  return {
    client,
    callOptions: toCallOptions(headers)
  };
}

function isUnauthenticatedError(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.Unauthenticated;
}

async function runWithEvent<T>(
  dependencies: AiRoutesDependencies,
  eventName: ApiEventSlug,
  operation: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  let success = false;

  try {
    const response = await operation();
    success = true;
    return response;
  } catch (error) {
    if (!isUnauthenticatedError(error)) {
      throw error;
    }

    const refreshed = await dependencies.refreshOnUnauthenticated();
    if (!refreshed) {
      throw error;
    }

    const retriedResponse = await operation();
    success = true;
    return retriedResponse;
  } finally {
    await dependencies.logEvent(eventName, performance.now() - start, success);
  }
}

function mapAiUsageRow(usage: AiServiceGetUsageResponse['usage'][number]): AiUsage {
  return {
    id: usage.id,
    conversationId: usage.conversationId ?? null,
    messageId: usage.messageId ?? null,
    userId: usage.userId,
    organizationId: usage.organizationId ?? null,
    modelId: usage.modelId,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    openrouterRequestId: usage.openrouterRequestId ?? null,
    createdAt: usage.createdAt
  };
}

function mapAiUsageSummary(
  summary:
    | AiServiceGetUsageResponse['summary']
    | AiServiceGetUsageSummaryResponse['summary']
): AiUsageSummary {
  return {
    totalPromptTokens: summary?.totalPromptTokens ?? 0,
    totalCompletionTokens: summary?.totalCompletionTokens ?? 0,
    totalTokens: summary?.totalTokens ?? 0,
    requestCount: summary?.requestCount ?? 0,
    periodStart: summary?.periodStart ?? '',
    periodEnd: summary?.periodEnd ?? ''
  };
}

function mapAiGetUsageResponse(
  response: AiServiceGetUsageResponse
): AiUsageListResponse {
  return {
    usage: response.usage.map(mapAiUsageRow),
    summary: mapAiUsageSummary(response.summary),
    hasMore: response.hasMore,
    ...(response.cursor !== undefined ? { cursor: response.cursor } : {})
  };
}

function mapAiGetUsageSummaryResponse(
  response: AiServiceGetUsageSummaryResponse
): AiUsageSummaryResponse {
  return {
    summary: mapAiUsageSummary(response.summary),
    byModel: Object.fromEntries(
      Object.entries(response.byModel).map(([modelId, summary]) => [
        modelId,
        mapAiUsageSummary(summary)
      ])
    )
  };
}

export function createAiRoutes(
  overrides: Partial<AiRoutesDependencies> = {}
) {
  const dependencies = {
    ...createDefaultDependencies(),
    ...overrides
  };
  const getClient = createClientResolver(dependencies);

  return {
    recordUsage: (data: RecordAiUsageRequest) =>
      request<RecordAiUsageResponse>(`${AI_V1_CONNECT_BASE_PATH}/RecordUsage`, {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_ai_usage'
      }),
    getUsage: (options?: {
      startDate?: string;
      endDate?: string;
      cursor?: string;
      limit?: number;
    }): Promise<AiUsageListResponse> =>
      runWithEvent(dependencies, 'api_get_ai_usage', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getUsage(
          create(AiServiceGetUsageRequestSchema, {
            ...(options?.startDate !== undefined
              ? { startDate: options.startDate }
              : {}),
            ...(options?.endDate !== undefined ? { endDate: options.endDate } : {}),
            ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
            ...(options?.limit !== undefined ? { limit: options.limit } : {})
          }),
          callOptions
        );
        return mapAiGetUsageResponse(response);
      }),
    getUsageSummary: (options?: {
      startDate?: string;
      endDate?: string;
    }): Promise<AiUsageSummaryResponse> =>
      runWithEvent(dependencies, 'api_get_ai_usage_summary', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getUsageSummary(
          create(AiServiceGetUsageSummaryRequestSchema, {
            ...(options?.startDate !== undefined
              ? { startDate: options.startDate }
              : {}),
            ...(options?.endDate !== undefined ? { endDate: options.endDate } : {})
          }),
          callOptions
        );
        return mapAiGetUsageSummaryResponse(response);
      })
  };
}

export const aiRoutes = createAiRoutes();
