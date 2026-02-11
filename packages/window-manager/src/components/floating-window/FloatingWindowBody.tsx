import type { PreMaximizeState, WindowDimensions } from './types.js';
import { WindowTitleBar } from './WindowTitleBar.js';

interface DragHandlers {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
}

interface FloatingWindowBodyProps {
  id: string;
  title: string;
  isDesktop: boolean;
  isMaximized: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  onMinimize?: ((dimensions: WindowDimensions) => void) | undefined;
  onClose: () => void;
  onToggleMaximize: () => void;
  dragHandlers: DragHandlers;
  titleBarRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  preMaximizeDimensions: PreMaximizeState | null;
  children: React.ReactNode;
}

export function FloatingWindowBody({
  id,
  title,
  isDesktop,
  isMaximized,
  width,
  height,
  x,
  y,
  onMinimize,
  onClose,
  onToggleMaximize,
  dragHandlers,
  titleBarRef,
  contentRef,
  preMaximizeDimensions,
  children
}: FloatingWindowBodyProps) {
  return (
    <>
      <WindowTitleBar
        id={id}
        title={title}
        isDesktop={isDesktop}
        isMaximized={isMaximized}
        width={width}
        height={height}
        x={x}
        y={y}
        onMinimize={onMinimize}
        onClose={onClose}
        onToggleMaximize={onToggleMaximize}
        dragHandlers={dragHandlers}
        titleBarRef={titleBarRef}
        preMaximizeDimensions={preMaximizeDimensions}
      />
      <div ref={contentRef} className="flex-1 overflow-auto">
        {children}
      </div>
    </>
  );
}
