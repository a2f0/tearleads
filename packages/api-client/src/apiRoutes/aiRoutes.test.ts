import { Code, ConnectError } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AiV2Client,
  createAiRoutes,
  createDefaultAiV2Client
} from './aiRoutes';

const { requestMock, createClientMock, createGrpcWebTransportMock } =
  vi.hoisted(() => ({
    requestMock: vi.fn(),
    createClientMock: vi.fn(),
    createGrpcWebTransportMock: vi.fn()
  }));

vi.mock('../apiCore', () => ({
  API_BASE_URL: 'https://api.example.test',
  request: requestMock,
  tryRefreshToken: vi.fn(async () => false)
}));

vi.mock('@connectrpc/connect', async () => {
  const actual = await vi.importActual<typeof import('@connectrpc/connect')>(
    '@connectrpc/connect'
  );
  return {
    ...actual,
    createClient: createClientMock
  };
});

vi.mock('@connectrpc/connect-web', async () => {
  const actual = await vi.importActual<
    typeof import('@connectrpc/connect-web')
  >('@connectrpc/connect-web');
  return {
    ...actual,
    createGrpcWebTransport: createGrpcWebTransportMock
  };
});

interface AiV2ClientOverrides {
  getUsage?: AiV2Client['getUsage'];
  getUsageSummary?: AiV2Client['getUsageSummary'];
}

function createAiV2ClientStub(
  overrides: AiV2ClientOverrides = {}
): AiV2Client {
  return {
    getUsage:
      overrides.getUsage ??
      vi.fn(async () => ({
        usage: [],
        summary: undefined,
        hasMore: false
      })),
    getUsageSummary:
      overrides.getUsageSummary ??
      vi.fn(async () => ({
        summary: undefined,
        byModel: {}
      }))
  };
}

function createRoutesForTest(
  client: AiV2Client,
  logEvent = vi.fn(async () => undefined),
  buildHeaders = vi.fn(async () => ({ authorization: 'Bearer token-123' })),
  refreshOnUnauthenticated = vi.fn(async () => false)
) {
  return {
    routes: createAiRoutes({
      resolveApiBaseUrl: () => 'https://api.example.test',
      normalizeConnectBaseUrl: async (apiBaseUrl) => `${apiBaseUrl}/connect`,
      buildHeaders,
      getAuthHeaderValue: () => 'Bearer token-123',
      createClient: () => client,
      refreshOnUnauthenticated,
      logEvent
    }),
    logEvent,
    buildHeaders,
    refreshOnUnauthenticated
  };
}

describe('aiRoutes', () => {
  beforeEach(() => {
    requestMock.mockReset();
    createClientMock.mockReset();
    createGrpcWebTransportMock.mockReset();
  });

  it('creates a default gRPC-web binary transport client', () => {
    const transport = { kind: 'transport' };
    const client = createAiV2ClientStub();
    createGrpcWebTransportMock.mockReturnValue(transport);
    createClientMock.mockReturnValue(client);

    const createdClient = createDefaultAiV2Client(
      'https://api.example.test/connect'
    );

    expect(createdClient).toBe(client);
    expect(createGrpcWebTransportMock).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.test/connect',
      useBinaryFormat: true
    });
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('maps v2 getUsage responses into the existing ai response shape', async () => {
    const getUsage = vi.fn(async () => ({
      usage: [
        {
          id: 'usage-1',
          userId: 'user-1',
          organizationId: 'org-1',
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          createdAt: '2026-03-09T18:00:00.000Z'
        }
      ],
      summary: {
        totalPromptTokens: 12,
        totalCompletionTokens: 8,
        totalTokens: 20,
        requestCount: 1,
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-03-09T18:00:00.000Z'
      },
      hasMore: false
    }));
    const client = createAiV2ClientStub({ getUsage });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.getUsage({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      cursor: 'cursor-1',
      limit: 25
    });

    expect(response).toEqual({
      usage: [
        {
          id: 'usage-1',
          conversationId: null,
          messageId: null,
          userId: 'user-1',
          organizationId: 'org-1',
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          openrouterRequestId: null,
          createdAt: '2026-03-09T18:00:00.000Z'
        }
      ],
      summary: {
        totalPromptTokens: 12,
        totalCompletionTokens: 8,
        totalTokens: 20,
        requestCount: 1,
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-03-09T18:00:00.000Z'
      },
      hasMore: false
    });
    expect(getUsage).toHaveBeenCalledTimes(1);
    expect(getUsage.mock.calls[0]?.[1]).toEqual({
      headers: {
        authorization: 'Bearer token-123'
      }
    });
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_ai_usage',
      expect.any(Number),
      true
    );
  });

  it('retries v2 summary reads after an unauthenticated response', async () => {
    const getUsageSummary = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError('Unauthorized', Code.Unauthenticated))
      .mockResolvedValueOnce({
        summary: {
          totalPromptTokens: 12,
          totalCompletionTokens: 8,
          totalTokens: 20,
          requestCount: 1,
          periodStart: '2026-03-01T00:00:00.000Z',
          periodEnd: '2026-03-09T18:00:00.000Z'
        },
        byModel: {
          'openai/gpt-4o-mini': {
            totalPromptTokens: 12,
            totalCompletionTokens: 8,
            totalTokens: 20,
            requestCount: 1,
            periodStart: '2026-03-01T00:00:00.000Z',
            periodEnd: '2026-03-09T18:00:00.000Z'
          }
        }
      });
    const refreshOnUnauthenticated = vi.fn(async () => true);
    const client = createAiV2ClientStub({ getUsageSummary });
    const { routes, logEvent } = createRoutesForTest(
      client,
      undefined,
      undefined,
      refreshOnUnauthenticated
    );

    const response = await routes.getUsageSummary({
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    });

    expect(refreshOnUnauthenticated).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      summary: {
        totalPromptTokens: 12,
        totalCompletionTokens: 8,
        totalTokens: 20,
        requestCount: 1,
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-03-09T18:00:00.000Z'
      },
      byModel: {
        'openai/gpt-4o-mini': {
          totalPromptTokens: 12,
          totalCompletionTokens: 8,
          totalTokens: 20,
          requestCount: 1,
          periodStart: '2026-03-01T00:00:00.000Z',
          periodEnd: '2026-03-09T18:00:00.000Z'
        }
      }
    });
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_ai_usage_summary',
      expect.any(Number),
      true
    );
  });

  it('keeps recordUsage on the legacy v1 connect path', async () => {
    requestMock.mockResolvedValueOnce({ usage: { id: 'usage-1' } });
    const routes = createAiRoutes();

    await routes.recordUsage({
      modelId: 'openai/gpt-4o-mini',
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20
    });

    expect(requestMock).toHaveBeenCalledWith(
      '/connect/tearleads.v1.AiService/RecordUsage',
      expect.objectContaining({
        eventName: 'api_post_ai_usage'
      })
    );
  });
});
