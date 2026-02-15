/**
 * AI Conversation and Usage Tracking Types
 *
 * These types support encrypted conversation storage and token usage tracking
 * for billing and analytics purposes.
 */

// =============================================================================
// Conversation Types
// =============================================================================

/** Role of a message in an AI conversation */
export type AiMessageRole = 'system' | 'user' | 'assistant';

/** AI conversation metadata (encrypted fields stored server-side) */
export interface AiConversation {
  id: string;
  userId: string;
  organizationId: string | null;
  encryptedTitle: string;
  encryptedSessionKey: string;
  modelId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Decrypted conversation for client-side use */
export interface DecryptedAiConversation {
  id: string;
  userId: string;
  organizationId: string | null;
  title: string;
  modelId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** AI message (encrypted content stored server-side) */
export interface AiMessage {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  encryptedContent: string;
  modelId: string | null;
  sequenceNumber: number;
  createdAt: string;
}

/** Decrypted message for client-side use */
export interface DecryptedAiMessage {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  content: string;
  modelId: string | null;
  sequenceNumber: number;
  createdAt: string;
}

// =============================================================================
// Usage Tracking Types
// =============================================================================

/** Token usage from a single AI request */
export interface AiUsage {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  userId: string;
  organizationId: string | null;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  openrouterRequestId: string | null;
  createdAt: string;
}

/** Token usage summary for a time period */
export interface AiUsageSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  requestCount: number;
  periodStart: string;
  periodEnd: string;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/** Request to create a new conversation */
export interface CreateAiConversationRequest {
  encryptedTitle: string;
  encryptedSessionKey: string;
  modelId?: string;
}

/** Response after creating a conversation */
export interface CreateAiConversationResponse {
  conversation: AiConversation;
}

/** Request to update a conversation */
export interface UpdateAiConversationRequest {
  encryptedTitle?: string;
  modelId?: string;
}

/** Response with a single conversation */
export interface AiConversationResponse {
  conversation: AiConversation;
}

/** Response with conversation list */
export interface AiConversationsListResponse {
  conversations: AiConversation[];
  hasMore: boolean;
  cursor?: string;
}

/** Response with conversation and its messages */
export interface AiConversationDetailResponse {
  conversation: AiConversation;
  messages: AiMessage[];
}

/** Request to add a message to a conversation */
export interface AddAiMessageRequest {
  role: AiMessageRole;
  encryptedContent: string;
  modelId?: string;
}

/** Response after adding a message */
export interface AddAiMessageResponse {
  message: AiMessage;
  conversation: AiConversation;
}

/** Request with usage data to record */
export interface RecordAiUsageRequest {
  conversationId?: string;
  messageId?: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  openrouterRequestId?: string;
}

/** Response after recording usage */
export interface RecordAiUsageResponse {
  usage: AiUsage;
}

/** Response with usage history */
export interface AiUsageListResponse {
  usage: AiUsage[];
  summary: AiUsageSummary;
  hasMore: boolean;
  cursor?: string;
}

/** Response with usage summary */
export interface AiUsageSummaryResponse {
  summary: AiUsageSummary;
  byModel: Record<string, AiUsageSummary>;
}

// =============================================================================
// Chat Completions Extension Types
// =============================================================================

/** Extended chat completion request with conversation context */
export interface AiChatCompletionRequest {
  model?: string;
  messages: Array<{
    role: AiMessageRole;
    content:
      | string
      | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  conversationId?: string;
  encryptedUserMessage?: string;
  encryptedAssistantMessage?: string;
}

/** Extended chat completion response with usage data */
export interface AiChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: 'assistant';
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}
