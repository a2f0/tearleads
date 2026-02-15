import type { WindowDimensions } from '@tearleads/window-manager';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';
import { ChatWindow as ChatWindowBase } from './ChatWindow';

interface ChatWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
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
  const openRequest = useWindowOpenRequest('chat');

  return (
    <ChatWindowBase
      id={id}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      initialDimensions={initialDimensions}
      openConversationId={openRequest?.conversationId}
      openRequestId={openRequest?.requestId}
    />
  );
}
