import type { Corner } from '../../hooks/useFloatingWindow.js';
import { cn } from '@tearleads/ui';
import { BORDER_CLASSES, POSITION_CLASSES } from './constants.js';

interface ResizeHandleProps {
  corner: Corner;
  windowId: string;
  handlers: {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}

export function ResizeHandle({
  corner,
  windowId,
  handlers
}: ResizeHandleProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Resize handle for mouse/touch drag only
    <div
      className={cn(
        'absolute z-10 h-4 w-4 touch-none border-transparent transition-colors hover:border-primary',
        POSITION_CLASSES[corner],
        BORDER_CLASSES[corner]
      )}
      onMouseDown={handlers.onMouseDown}
      onTouchStart={handlers.onTouchStart}
      data-testid={`floating-window-${windowId}-resize-handle-${corner}`}
    />
  );
}
