import type { DecryptedAiConversation } from '@tearleads/shared';
import { useEffect, useRef } from 'react';
import { readLastConversationId } from './conversationResumeStorage';

interface UseConversationBootstrapInput {
  autoStart: boolean;
  resumeLastConversation: boolean;
  instanceId?: string | null;
  loading: boolean;
  messagesLoading: boolean;
  currentConversationId: string | null;
  conversations: DecryptedAiConversation[];
  createConversation: () => Promise<string>;
  selectConversation: (id: string | null) => Promise<void>;
  setInitializationError: (message: string) => void;
}

export function useConversationBootstrap(
  input: UseConversationBootstrapInput
): void {
  const {
    autoStart,
    resumeLastConversation,
    instanceId,
    loading,
    messagesLoading,
    currentConversationId,
    conversations,
    createConversation,
    selectConversation,
    setInitializationError
  } = input;

  const hasBootstrappedConversationRef = useRef(false);
  const isBootstrappingConversationRef = useRef(false);

  useEffect(() => {
    hasBootstrappedConversationRef.current = false;
    isBootstrappingConversationRef.current = false;
  }, [instanceId]);

  useEffect(() => {
    if (!autoStart && !resumeLastConversation) {
      return;
    }
    if (loading || messagesLoading) {
      return;
    }
    if (isBootstrappingConversationRef.current) {
      return;
    }
    if (hasBootstrappedConversationRef.current) {
      return;
    }
    if (currentConversationId) {
      hasBootstrappedConversationRef.current = true;
      return;
    }

    const initializeConversation = async () => {
      isBootstrappingConversationRef.current = true;
      try {
        const lastConversationId = resumeLastConversation
          ? readLastConversationId(instanceId)
          : null;

        if (lastConversationId) {
          const match = conversations.find((c) => c.id === lastConversationId);
          if (match) {
            await selectConversation(match.id);
            return;
          }
        }

        if (conversations.length > 0) {
          await selectConversation(conversations[0].id);
          return;
        }

        if (autoStart) {
          await createConversation();
        }
      } catch (err) {
        setInitializationError(
          err instanceof Error
            ? err.message
            : 'Failed to initialize conversation'
        );
      } finally {
        hasBootstrappedConversationRef.current = true;
        isBootstrappingConversationRef.current = false;
      }
    };

    void initializeConversation();
  }, [
    autoStart,
    conversations,
    createConversation,
    currentConversationId,
    instanceId,
    loading,
    messagesLoading,
    resumeLastConversation,
    selectConversation,
    setInitializationError
  ]);
}
