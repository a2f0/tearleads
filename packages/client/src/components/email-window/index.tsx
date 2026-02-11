import { EmailWindow as EmailWindowBase } from '@tearleads/email';
import type { WindowDimensions } from '@tearleads/window-manager';
import { ClientEmailProvider } from '@/contexts/ClientEmailProvider';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';

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
  const openRequest = useWindowOpenRequest('email');

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
        {...(openRequest && { openComposeRequest: openRequest })}
      />
    </ClientEmailProvider>
  );
}
