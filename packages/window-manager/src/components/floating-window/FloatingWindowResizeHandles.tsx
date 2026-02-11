import type { Corner } from '../../hooks/useFloatingWindow.js';
import { ResizeHandle } from './ResizeHandle.js';

interface FloatingWindowResizeHandlesProps {
  id: string;
  createCornerHandlers: (corner: Corner) => {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}

const CORNERS: Corner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
];

export function FloatingWindowResizeHandles({
  id,
  createCornerHandlers
}: FloatingWindowResizeHandlesProps) {
  return (
    <>
      {CORNERS.map((corner) => (
        <ResizeHandle
          key={corner}
          corner={corner}
          windowId={id}
          handlers={createCornerHandlers(corner)}
        />
      ))}
    </>
  );
}
