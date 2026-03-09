import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import { useCallback, useState } from 'react';
import {
  useAIConversations,
  useAIDatabaseState,
  useAILLM,
  useAIUI
} from '../../context';
import { ChatInterface, NoModelLoadedContent } from '../chat';
import { ConversationsSidebar } from '../sidebar';
import { AIWindowMenuBar } from './AIWindowMenuBar';

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

export interface AIWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AIWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: AIWindowProps) {
  const databaseState = useAIDatabaseState();
  const llm = useAILLM();
  const conversations = useAIConversations();
  const { InlineUnlock } = useAIUI();

  const [sidebarWidth, setSidebarWidth] = useState(200);

  const handleNewConversation = useCallback(async () => {
    await conversations.create();
  }, [conversations]);

  const handleConversationSelect = useCallback(
    async (conversationId: string | null) => {
      await conversations.select(conversationId);
    },
    [conversations]
  );

  const handleRenameConversation = useCallback(
    async (conversationId: string, title: string) => {
      await conversations.rename(conversationId, title);
    },
    [conversations]
  );

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      await conversations.delete(conversationId);
    },
    [conversations]
  );

  const modelDisplayName = llm.loadedModel
    ? getModelDisplayName(llm.loadedModel)
    : undefined;

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
        {databaseState.isUnlocked && (
          <AIWindowMenuBar
            onNewChat={handleNewConversation}
            onClose={onClose}
            modelDisplayName={modelDisplayName}
          />
        )}
        <WindowControlBar>{null}</WindowControlBar>

        {databaseState.isLoading && (
          <div className="flex flex-1 items-center justify-center rounded-lg border p-8 text-center text-muted-foreground">
            Loading database...
          </div>
        )}

        {!databaseState.isLoading && !databaseState.isUnlocked && (
          <div className="flex flex-1 items-center justify-center p-4">
            <InlineUnlock description="AI" />
          </div>
        )}

        {databaseState.isUnlocked && (
          <div className="flex flex-1 overflow-hidden">
            <ConversationsSidebar
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              conversations={conversations.list}
              selectedConversationId={conversations.currentId}
              onConversationSelect={handleConversationSelect}
              onNewConversation={handleNewConversation}
              onRenameConversation={handleRenameConversation}
              onDeleteConversation={handleDeleteConversation}
              loading={conversations.loading}
              error={conversations.error}
            />
            <div className="flex flex-1 flex-col overflow-hidden">
              {llm.loadedModel ? (
                <ChatInterface key={conversations.currentId ?? 'default'} />
              ) : (
                <NoModelLoadedContent />
              )}
            </div>
          </div>
        )}
      </div>
    </FloatingWindow>
  );
}
