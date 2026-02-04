import { OPENROUTER_CHAT_MODELS } from '@rapid/shared';
import { useState } from 'react';
import { useConversations } from '@/hooks/useConversations';
import { useLLM } from '@/hooks/useLLM';
import { ChatHeader } from './ChatHeader';
import { ChatInterface } from './ChatInterface';
import { ConversationsSidebar } from './ConversationsSidebar';
import { NoModelLoadedContent } from './NoModelLoadedContent';

/**
 * Derives a display name from an ONNX model ID.
 * Example: onnx-community/Phi-3.5-mini-instruct-onnx-web -> Phi 3.5 Mini
 */
function getModelDisplayName(modelId: string): string {
  const openRouterModel = OPENROUTER_CHAT_MODELS.find(
    (model) => model.id === modelId
  );
  if (openRouterModel) {
    return openRouterModel.name;
  }

  // Extract the model name part after the org/
  const modelName = modelId.includes('/')
    ? (modelId.split('/')[1] ?? modelId)
    : modelId;

  // Parse the name
  return modelName
    .replace(/-4k-instruct$/, '')
    .replace(/-instruct$/, '')
    .split('-')
    .slice(0, 3)
    .map((part) => {
      // Capitalize first letter of each part
      if (part.length > 0) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
      return part;
    })
    .join(' ')
    .trim();
}

export function Chat() {
  const { loadedModel, modelType, generate } = useLLM();
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    currentConversationId,
    selectConversation,
    createConversation,
    renameConversation,
    deleteConversation
  } = useConversations();

  const [sidebarWidth, setSidebarWidth] = useState(220);

  const modelDisplayName = loadedModel
    ? getModelDisplayName(loadedModel)
    : undefined;

  const isVisionModel = modelType === 'vision' || modelType === 'paligemma';

  const handleNewConversation = async () => {
    await createConversation();
  };

  const handleConversationSelect = async (id: string | null) => {
    await selectConversation(id);
  };

  return (
    <div className="flex h-full">
      <ConversationsSidebar
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        conversations={conversations}
        selectedConversationId={currentConversationId}
        onConversationSelect={handleConversationSelect}
        onNewConversation={handleNewConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
        loading={conversationsLoading}
        error={conversationsError}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <ChatHeader modelDisplayName={modelDisplayName} />
        {loadedModel ? (
          <ChatInterface generate={generate} isVisionModel={isVisionModel} />
        ) : (
          <NoModelLoadedContent />
        )}
      </div>
    </div>
  );
}
