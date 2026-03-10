import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('admin api client ai usage routes', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let apiClient: Awaited<ReturnType<typeof loadApi>>;

  async function loadApi() {
    return (await import('./api')).api;
  }

  beforeEach(async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.test');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    apiClient = await loadApi();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('maps ai usage reads from the v2 proto response shape', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
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
      })
    );

    await expect(
      apiClient.ai.getUsage({
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        limit: 25
      })
    ).resolves.toEqual({
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
  });
});
