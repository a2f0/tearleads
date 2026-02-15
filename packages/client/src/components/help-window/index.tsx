import { HelpWindow as HelpWindowBase } from '@tearleads/help';
import type { WindowDimensions } from '@tearleads/window-manager';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';

interface HelpWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

/**
 * HelpWindow wrapped with window open request support.
 * This enables opening specific help docs from other windows (e.g., search).
 */
export function HelpWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: HelpWindowProps) {
  const openRequest = useWindowOpenRequest('help');

  return (
    <HelpWindowBase
      id={id}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      initialDimensions={initialDimensions}
      openHelpDocId={openRequest?.helpDocId}
      openRequestId={openRequest?.requestId}
    />
  );
}
