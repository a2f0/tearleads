import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { EncryptedChat } from '@/pages/encrypted-chat';

interface EncryptedChatWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function EncryptedChatWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: EncryptedChatWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Encrypted Chat"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions !== undefined && { initialDimensions })}
      defaultWidth={800}
      defaultHeight={600}
      minWidth={600}
      minHeight={400}
    >
      <EncryptedChat />
    </FloatingWindow>
  );
}
