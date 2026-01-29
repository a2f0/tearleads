import { EmailWindow as EmailWindowBase } from '@rapid/email';
import type { WindowDimensions } from '@rapid/window-manager';
import { ClientEmailProvider } from '@/contexts/ClientEmailProvider';

interface EmailWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function EmailWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: EmailWindowProps) {
  return (
    <ClientEmailProvider>
      <EmailWindowBase
        id={id}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        initialDimensions={initialDimensions}
      />
    </ClientEmailProvider>
  );
}
