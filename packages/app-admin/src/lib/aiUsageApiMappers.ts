import type { AiUsageListResponse, AiUsageSummary } from '@tearleads/shared';
import type {
  AiServiceGetUsageResponse,
  AiUsage as ProtoAiUsage
} from '@tearleads/shared/gen/tearleads/v2/ai_pb';

function mapAiUsageSummary(
  summary: AiServiceGetUsageResponse['summary']
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

function mapAiUsage(usage: ProtoAiUsage) {
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

export function mapAiGetUsageResponse(
  response: AiServiceGetUsageResponse
): AiUsageListResponse {
  return {
    usage: response.usage.map(mapAiUsage),
    summary: mapAiUsageSummary(response.summary),
    hasMore: response.hasMore,
    ...(response.cursor !== undefined ? { cursor: response.cursor } : {})
  };
}
