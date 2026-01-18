import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useLLM } from '@/hooks/useLLM';
import { ChatInterface } from '@/pages/chat/ChatInterface';
import { NoModelLoadedContent } from '@/pages/chat/NoModelLoadedContent';
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

  const handleNewChat = useCallback(() => {
    setChatKey((prev) => prev + 1);
  }, []);

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
        <ChatWindowMenuBar onNewChat={handleNewChat} onClose={onClose} />
        <div className="flex-1 overflow-hidden">
          {loadedModel ? (
            <ChatInterface
              key={chatKey}
              generate={generate}
              isVisionModel={isVisionModel}
            />
          ) : (
            <NoModelLoadedContent />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
