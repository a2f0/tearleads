import type {
  AddAiMessageRequest,
  AddAiMessageResponse,
  AiConversationDetailResponse,
  AiConversationResponse,
  AiConversationsListResponse,
  AiUsageListResponse,
  AiUsageSummaryResponse,
  CreateAiConversationRequest,
  CreateAiConversationResponse,
  RecordAiUsageRequest,
  RecordAiUsageResponse,
  UpdateAiConversationRequest
} from '@tearleads/shared';
import { request } from '../apiCore';

export const aiRoutes = {
  createConversation: (data: CreateAiConversationRequest) =>
    request<CreateAiConversationResponse>('/ai/conversations', {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      eventName: 'api_post_ai_conversation'
    }),
  listConversations: (options?: { cursor?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<AiConversationsListResponse>(
      `/ai/conversations${query ? `?${query}` : ''}`,
      { eventName: 'api_get_ai_conversations' }
    );
  },
  getConversation: (id: string) =>
    request<AiConversationDetailResponse>(
      `/ai/conversations/${encodeURIComponent(id)}`,
      { eventName: 'api_get_ai_conversation' }
    ),
  updateConversation: (id: string, data: UpdateAiConversationRequest) =>
    request<AiConversationResponse>(
      `/ai/conversations/${encodeURIComponent(id)}`,
      {
        fetchOptions: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_patch_ai_conversation'
      }
    ),
  deleteConversation: (id: string) =>
    request<void>(`/ai/conversations/${encodeURIComponent(id)}`, {
      fetchOptions: { method: 'DELETE' },
      eventName: 'api_delete_ai_conversation'
    }),
  addMessage: (conversationId: string, data: AddAiMessageRequest) =>
    request<AddAiMessageResponse>(
      `/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_ai_message'
      }
    ),
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
