import type {
  DecryptedAiConversation,
  DecryptedAiMessage
} from '@tearleads/shared';

export interface UseConversationsResult {
  conversations: DecryptedAiConversation[];
  loading: boolean;
  error: string | null;

  currentConversationId: string | null;
  currentMessages: DecryptedAiMessage[];
  currentSessionKey: Uint8Array | null;
  messagesLoading: boolean;

  createConversation: (firstMessage?: string) => Promise<string>;
  selectConversation: (id: string | null) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  addMessage: (
    role: 'user' | 'assistant',
    content: string,
    modelId?: string
  ) => Promise<void>;

  refetch: () => Promise<void>;
  clearCurrentConversation: () => void;
}

export interface UseConversationsOptions {
  autoStart?: boolean;
  resumeLastConversation?: boolean;
  instanceId?: string | null;
}
