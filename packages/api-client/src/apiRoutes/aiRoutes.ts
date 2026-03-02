import type {
  AiUsageListResponse,
  AiUsageSummaryResponse,
  RecordAiUsageRequest,
  RecordAiUsageResponse
} from '@tearleads/shared';
import { request } from '../apiCore';

const AI_CONNECT_BASE_PATH = '/connect/tearleads.v1.AiService';

export const aiRoutes = {
  recordUsage: (data: RecordAiUsageRequest) =>
    request<RecordAiUsageResponse>(`${AI_CONNECT_BASE_PATH}/RecordUsage`, {
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
  }) =>
    request<AiUsageListResponse>(`${AI_CONNECT_BASE_PATH}/GetUsage`, {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options ?? {})
      },
      eventName: 'api_get_ai_usage'
    }),
  getUsageSummary: (options?: { startDate?: string; endDate?: string }) => {
    return request<AiUsageSummaryResponse>(
      `${AI_CONNECT_BASE_PATH}/GetUsageSummary`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options ?? {})
        },
        eventName: 'api_get_ai_usage_summary'
      }
    );
  }
};
