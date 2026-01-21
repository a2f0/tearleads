import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Button } from '@/components/ui/button';
import { useLLM } from '@/hooks/useLLM';
import { ChatInterface } from '@/pages/chat/ChatInterface';
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
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function ChatWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: ChatWindowProps) {
  const { loadedModel, modelType, generate } = useLLM();
  const [chatKey, setChatKey] = useState(0);
  const [activeView, setActiveView] = useState<'chat' | 'models'>('chat');

  const handleNewChat = useCallback(() => {
    setChatKey((prev) => prev + 1);
    setActiveView('chat');
  }, []);

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

  const title = modelDisplayName ? `Chat - ${modelDisplayName}` : 'Chat';

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions !== undefined && { initialDimensions })}
      defaultWidth={500}
      defaultHeight={550}
      minWidth={400}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <ChatWindowMenuBar
          onNewChat={handleNewChat}
          onClose={onClose}
          modelDisplayName={modelDisplayName}
        />
        <div className="flex-1 overflow-hidden">
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
                  Back to Chat
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <ModelsContent showBackLink={false} />
              </div>
            </div>
          ) : loadedModel ? (
            <ChatInterface
              key={chatKey}
              generate={generate}
              isVisionModel={isVisionModel}
            />
          ) : (
            <NoModelLoadedContent onOpenModels={handleOpenModels} />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
