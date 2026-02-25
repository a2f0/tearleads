import type {
  AiUsageListResponse,
  AiUsageSummaryResponse,
  RecordAiUsageRequest,
  RecordAiUsageResponse
} from '@tearleads/shared';
import { request } from '../apiCore';

export const aiRoutes = {
  recordUsage: (data: RecordAiUsageRequest) =>
    request<RecordAiUsageResponse>('/ai/usage', {
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
  }) => {
    const params = new URLSearchParams();
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<AiUsageListResponse>(
      `/ai/usage${query ? `?${query}` : ''}`,
      {
        eventName: 'api_get_ai_usage'
      }
    );
  },
  getUsageSummary: (options?: { startDate?: string; endDate?: string }) => {
    const params = new URLSearchParams();
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    const query = params.toString();
    return request<AiUsageSummaryResponse>(
      `/ai/usage/summary${query ? `?${query}` : ''}`,
      { eventName: 'api_get_ai_usage_summary' }
    );
  }
};
