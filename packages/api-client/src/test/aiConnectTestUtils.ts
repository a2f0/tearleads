import { HttpResponse, http, server } from '@tearleads/msw/node';

export const AI_CONNECT_RECORD_USAGE_PATH =
  '/connect/tearleads.v1.AiService/RecordUsage';
export const AI_CONNECT_USAGE_PATH = '/connect/tearleads.v1.AiService/GetUsage';
export const AI_CONNECT_USAGE_SUMMARY_PATH =
  '/connect/tearleads.v1.AiService/GetUsageSummary';

const CONNECT_BASE_URL = 'http://localhost';
const DEFAULT_USAGE_SUMMARY = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  periodStart: '2024-01-01T00:00:00.000Z',
  periodEnd: '2024-01-01T00:00:00.000Z'
};

const toConnectUrl = (path: string): string => `${CONNECT_BASE_URL}${path}`;

export interface SingleAiUsageCapture {
  recordUsageRequestBody?: unknown;
  getUsageRequestBody?: unknown;
  getUsageSummaryRequestBody?: unknown;
}

export interface SeriesAiUsageCapture {
  getUsageRequestBodies: unknown[];
  getUsageSummaryRequestBodies: unknown[];
}

export const installAiUsageConnectSingleCapture = (
  userId: string
): SingleAiUsageCapture => {
  const captured: SingleAiUsageCapture = {};

  server.use(
    http.post(
      toConnectUrl(AI_CONNECT_RECORD_USAGE_PATH),
      async ({ request }) => {
        captured.recordUsageRequestBody = await request.json();
        return HttpResponse.json({
          usage: {
            id: 'usage-1',
            userId,
            modelId: 'mistralai/mistral-7b-instruct',
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            createdAt: '2024-01-01T00:00:00.000Z'
          }
        });
      }
    ),
    http.post(toConnectUrl(AI_CONNECT_USAGE_PATH), async ({ request }) => {
      captured.getUsageRequestBody = await request.json();
      return HttpResponse.json({
        usage: [],
        summary: DEFAULT_USAGE_SUMMARY,
        hasMore: false
      });
    }),
    http.post(
      toConnectUrl(AI_CONNECT_USAGE_SUMMARY_PATH),
      async ({ request }) => {
        captured.getUsageSummaryRequestBody = await request.json();
        return HttpResponse.json({
          summary: DEFAULT_USAGE_SUMMARY,
          byModel: {}
        });
      }
    )
  );

  return captured;
};

export const installAiUsageConnectSeriesCapture = (): SeriesAiUsageCapture => {
  const captured: SeriesAiUsageCapture = {
    getUsageRequestBodies: [],
    getUsageSummaryRequestBodies: []
  };

  server.use(
    http.post(toConnectUrl(AI_CONNECT_USAGE_PATH), async ({ request }) => {
      captured.getUsageRequestBodies.push(await request.json());
      return HttpResponse.json({
        usage: [],
        summary: DEFAULT_USAGE_SUMMARY,
        hasMore: false
      });
    }),
    http.post(
      toConnectUrl(AI_CONNECT_USAGE_SUMMARY_PATH),
      async ({ request }) => {
        captured.getUsageSummaryRequestBodies.push(await request.json());
        return HttpResponse.json({
          summary: DEFAULT_USAGE_SUMMARY,
          byModel: {}
        });
      }
    )
  );

  return captured;
};
