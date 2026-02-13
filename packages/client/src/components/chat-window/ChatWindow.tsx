import { WindowControlBar } from '@tearleads/window-manager';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { useDatabaseContext } from '@/db/hooks';
import { useConversations } from '@/hooks/useConversations';
import { useLLM } from '@/hooks/useLLM';
import { ChatInterface } from '@/pages/chat/ChatInterface';
import { ConversationsSidebar } from '@/pages/chat/ConversationsSidebar';
import { NoModelLoadedContent } from '@/pages/chat/NoModelLoadedContent';
import { ModelsContent } from '@/pages/models/ModelsContent';
import { ChatWindowMenuBar } from './ChatWindowMenuBar';

function getModelDisplayName(modelId: string): string {
  const modelName = modelId.includes('/')
    ? (modelId.split('/')[1] ?? modelId)
    : modelId;

  return modelName
    .replace(/-4k-instruct$/, '')
    .replace(/-instruct$/, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface ChatWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function ChatWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: ChatWindowProps) {
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();
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

  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [activeView, setActiveView] = useState<'chat' | 'models'>('chat');

  const handleNewConversation = useCallback(async () => {
    await createConversation();
  }, [createConversation]);

  const handleConversationSelect = useCallback(
    async (conversationId: string | null) => {
      await selectConversation(conversationId);
    },
    [selectConversation]
  );

  const handleOpenModels = useCallback(() => {
    setActiveView('models');
  }, []);

  const handleBackToChat = useCallback(() => {
    setActiveView('chat');
  }, []);

  useEffect(() => {
    if (loadedModel && activeView === 'models') {
      setActiveView('chat');
    }
  }, [activeView, loadedModel]);

  const modelDisplayName = loadedModel
    ? getModelDisplayName(loadedModel)
    : undefined;

  const isVisionModel = modelType === 'vision' || modelType === 'paligemma';

  const title = modelDisplayName ? `AI - ${modelDisplayName}` : 'AI';

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions !== undefined && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col overflow-hidden">
        {isUnlocked && (
          <ChatWindowMenuBar
            onNewChat={handleNewConversation}
            onClose={onClose}
            modelDisplayName={modelDisplayName}
          />
        )}
        <WindowControlBar>{null}</WindowControlBar>

        {isDatabaseLoading && (
          <div className="flex flex-1 items-center justify-center rounded-lg border p-8 text-center text-muted-foreground">
            Loading database...
          </div>
        )}

        {!isDatabaseLoading && !isUnlocked && (
          <div className="flex flex-1 items-center justify-center p-4">
            <InlineUnlock description="AI" />
          </div>
        )}

        {isUnlocked && (
          <div className="flex flex-1 overflow-hidden">
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
              {activeView === 'models' ? (
                <div className="flex h-full flex-col">
                  <div className="border-b bg-muted/30 px-2 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleBackToChat}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back to AI
                    </Button>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    <ModelsContent showBackLink={false} />
                  </div>
                </div>
              ) : loadedModel ? (
                <ChatInterface
                  key={currentConversationId ?? 'default'}
                  generate={generate}
                  isVisionModel={isVisionModel}
                />
              ) : (
                <NoModelLoadedContent onOpenModels={handleOpenModels} />
              )}
            </div>
          </div>
        )}
      </div>
    </FloatingWindow>
  );
}
