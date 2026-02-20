/**
 * Client-side AIUIProvider wrapper that supplies all dependencies
 * to the @tearleads/ai package components.
 */

import {
  type AIUIComponents,
  AIUIProvider,
  type DecryptedConversation
} from '@tearleads/ai';
import type { DecryptedAiConversation } from '@tearleads/shared';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { ModelSelector } from '@/components/ModelSelector';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { useDatabaseContext } from '@/db/hooks';
import { useLLM } from '@/hooks/llm';
import { useConversations } from '@/hooks/useConversations';
import { useTranslation } from '@/i18n';
import { getAttachedImage, setAttachedImage } from '@/lib/llmRuntime';
import { PhotoPicker } from '@/pages/chat/PhotoPicker';
import { logStore } from '@/stores/logStore';

const aiUIComponents: AIUIComponents = {
  Button,
  Input,
  InlineUnlock,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  ModelSelector
};

interface ClientAIProviderProps {
  children: ReactNode;
  navigateToModels?: () => void;
}

/**
 * Map DecryptedAiConversation to DecryptedConversation for the AI package
 */
function mapConversation(conv: DecryptedAiConversation): DecryptedConversation {
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt
  };
}

export function ClientAIProvider({
  children,
  navigateToModels
}: ClientAIProviderProps) {
  const databaseContext = useDatabaseContext();
  const { t } = useTranslation();
  const llm = useLLM();
  const conversations = useConversations();

  // Photo picker state
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [photoPickerResolve, setPhotoPickerResolve] = useState<
    ((value: string | null) => void) | null
  >(null);

  const databaseState = useMemo(
    () => ({
      isUnlocked: databaseContext.isUnlocked,
      isLoading: databaseContext.isLoading,
      currentInstanceId: databaseContext.currentInstanceId
    }),
    [
      databaseContext.isUnlocked,
      databaseContext.isLoading,
      databaseContext.currentInstanceId
    ]
  );

  const llmState = useMemo(
    () => ({
      loadedModel: llm.loadedModel,
      modelType: llm.modelType,
      isLoading: llm.isLoading,
      loadProgress: llm.loadProgress,
      error: llm.error,
      generate: llm.generate,
      abort: llm.abort
    }),
    [
      llm.loadedModel,
      llm.modelType,
      llm.isLoading,
      llm.loadProgress,
      llm.error,
      llm.generate,
      llm.abort
    ]
  );

  const conversationsState = useMemo(
    () => ({
      list: conversations.conversations.map(mapConversation),
      loading: conversations.loading,
      error: conversations.error,
      currentId: conversations.currentConversationId,
      select: conversations.selectConversation,
      create: async () => {
        return await conversations.createConversation();
      },
      rename: conversations.renameConversation,
      delete: conversations.deleteConversation
    }),
    [
      conversations.conversations,
      conversations.loading,
      conversations.error,
      conversations.currentConversationId,
      conversations.selectConversation,
      conversations.createConversation,
      conversations.renameConversation,
      conversations.deleteConversation
    ]
  );

  const selectPhoto = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      setPhotoPickerResolve(() => resolve);
      setShowPhotoPicker(true);
    });
  }, []);

  const handlePhotoSelect = useCallback(
    (imageDataUrl: string) => {
      if (photoPickerResolve) {
        photoPickerResolve(imageDataUrl);
        setPhotoPickerResolve(null);
      }
      setShowPhotoPicker(false);
    },
    [photoPickerResolve]
  );

  const handlePhotoPickerClose = useCallback(() => {
    if (photoPickerResolve) {
      photoPickerResolve(null);
      setPhotoPickerResolve(null);
    }
    setShowPhotoPicker(false);
  }, [photoPickerResolve]);

  const logError = useCallback(
    (message: string, details?: string) => logStore.error(message, details),
    []
  );

  const logWarn = useCallback(
    (message: string, details?: string) => logStore.warn(message, details),
    []
  );

  const imageAttachment = useMemo(
    () => ({
      getAttachedImage,
      setAttachedImage
    }),
    []
  );

  return (
    <AIUIProvider
      databaseState={databaseState}
      ui={aiUIComponents}
      t={t}
      llm={llmState}
      conversations={conversationsState}
      selectPhoto={selectPhoto}
      imageAttachment={imageAttachment}
      logError={logError}
      logWarn={logWarn}
      {...(navigateToModels && { navigateToModels })}
    >
      {children}
      {showPhotoPicker && (
        <PhotoPicker
          onSelect={handlePhotoSelect}
          onClose={handlePhotoPickerClose}
        />
      )}
    </AIUIProvider>
  );
}
