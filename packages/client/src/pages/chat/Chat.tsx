import {
  ChatInterface,
  ConversationsSidebar,
  NoModelLoadedContent,
  useAIConversations,
  useAIDatabaseState,
  useAILLM
} from '@tearleads/ai';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientAIProvider } from '@/contexts/ClientAIProvider';
import { ChatHeader } from './ChatHeader';

function ChatContent() {
  const databaseState = useAIDatabaseState();
  const llm = useAILLM();
  const conversations = useAIConversations();

  const [sidebarWidth, setSidebarWidth] = useState(220);

  const modelDisplayName = llm.loadedModel
    ? getModelDisplayName(llm.loadedModel)
    : undefined;

  const handleNewConversation = async () => {
    await conversations.create();
  };

  const handleConversationSelect = async (id: string | null) => {
    await conversations.select(id);
  };

  if (databaseState.isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border p-8 text-center text-muted-foreground">
        Loading database...
      </div>
    );
  }

  if (!databaseState.isUnlocked) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <InlineUnlock description="AI" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ConversationsSidebar
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        conversations={conversations.list}
        selectedConversationId={conversations.currentId}
        onConversationSelect={handleConversationSelect}
        onNewConversation={handleNewConversation}
        onRenameConversation={conversations.rename}
        onDeleteConversation={conversations.delete}
        loading={conversations.loading}
        error={conversations.error}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <ChatHeader modelDisplayName={modelDisplayName} />
        {llm.loadedModel ? (
          <ChatInterface key={conversations.currentId ?? 'default'} />
        ) : (
          <NoModelLoadedContent />
        )}
      </div>
    </div>
  );
}

/**
 * Derives a display name from an ONNX model ID.
 * Example: onnx-community/Phi-3.5-mini-instruct-onnx-web -> Phi 3.5 Mini
 */
function getModelDisplayName(modelId: string): string {
  const modelName = modelId.includes('/')
    ? (modelId.split('/')[1] ?? modelId)
    : modelId;

  return modelName
    .replace(/-4k-instruct$/, '')
    .replace(/-instruct$/, '')
    .split('-')
    .slice(0, 3)
    .map((part) => {
      if (part.length > 0) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
      return part;
    })
    .join(' ')
    .trim();
}

export function Chat() {
  const navigate = useNavigate();

  const handleNavigateToModels = () => {
    navigate('/models');
  };

  return (
    <ClientAIProvider navigateToModels={handleNavigateToModels}>
      <ChatContent />
    </ClientAIProvider>
  );
}
