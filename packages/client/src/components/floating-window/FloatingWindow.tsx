import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Corner } from '@/hooks/useFloatingWindow';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import { cn } from '@/lib/utils';

const DESKTOP_BREAKPOINT = 768;

const POSITION_CLASSES: Record<Corner, string> = {
  'top-left': 'top-0 left-0',
  'top-right': 'top-0 right-0',
  'bottom-left': 'bottom-0 left-0',
  'bottom-right': 'bottom-0 right-0'
};

const BORDER_CLASSES: Record<Corner, string> = {
  'top-left': 'border-t-2 border-l-2 rounded-tl-lg',
  'top-right': 'border-t-2 border-r-2 rounded-tr-lg',
  'bottom-left': 'border-b-2 border-l-2 rounded-bl-lg',
  'bottom-right': 'border-b-2 border-r-2 rounded-br-lg'
};

interface ResizeHandleProps {
  corner: Corner;
  windowId: string;
  handlers: {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}

function ResizeHandle({ corner, windowId, handlers }: ResizeHandleProps) {
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

export interface FloatingWindowProps {
  id: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultX?: number;
  defaultY?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidthPercent?: number;
  maxHeightPercent?: number;
  zIndex?: number;
  onFocus?: () => void;
}

export function FloatingWindow({
  id,
  title,
  children,
  onClose,
  defaultWidth = 500,
  defaultHeight = 400,
  defaultX,
  defaultY,
  minWidth = 300,
  minHeight = 200,
  maxWidthPercent = 0.8,
  maxHeightPercent = 0.8,
  zIndex = 50,
  onFocus
}: FloatingWindowProps) {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT
  );

  const { width, height, x, y, createCornerHandlers, createDragHandlers } =
    useFloatingWindow({
      defaultWidth,
      defaultHeight,
      defaultX:
        defaultX ??
        (typeof window !== 'undefined'
          ? Math.max(50, (window.innerWidth - defaultWidth) / 2)
          : 0),
      defaultY:
        defaultY ??
        (typeof window !== 'undefined'
          ? Math.max(50, (window.innerHeight - defaultHeight) / 2)
          : 0),
      minWidth,
      minHeight,
      maxWidthPercent,
      maxHeightPercent
    });

  const dragHandlers = createDragHandlers();

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleWindowClick = () => {
    onFocus?.();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Window focus on click
    <div
      className={cn(
        'fixed flex flex-col overflow-hidden border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80',
        isDesktop ? 'rounded-lg' : 'inset-x-0 bottom-0 rounded-t-lg'
      )}
      style={{
        zIndex,
        ...(isDesktop
          ? {
              width: `${width}px`,
              height: `${height}px`,
              left: `${x}px`,
              top: `${y}px`,
              maxWidth: `${maxWidthPercent * 100}vw`,
              maxHeight: `${maxHeightPercent * 100}vh`
            }
          : {
              height: `${height}px`,
              maxHeight: `${maxHeightPercent * 100}vh`
            })
      }}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      onClick={handleWindowClick}
      data-testid={`floating-window-${id}`}
    >
      {isDesktop && (
        <>
          <ResizeHandle
            corner="top-left"
            windowId={id}
            handlers={createCornerHandlers('top-left')}
          />
          <ResizeHandle
            corner="top-right"
            windowId={id}
            handlers={createCornerHandlers('top-right')}
          />
          <ResizeHandle
            corner="bottom-left"
            windowId={id}
            handlers={createCornerHandlers('bottom-left')}
          />
          <ResizeHandle
            corner="bottom-right"
            windowId={id}
            handlers={createCornerHandlers('bottom-right')}
          />
        </>
      )}

      {/* Title bar - draggable on desktop */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Title bar for mouse/touch drag only */}
      <div
        className={cn(
          'flex h-7 shrink-0 items-center justify-between border-b bg-muted/50 px-2',
          isDesktop && 'cursor-grab active:cursor-grabbing'
        )}
        onMouseDown={isDesktop ? dragHandlers.onMouseDown : undefined}
        onTouchStart={isDesktop ? dragHandlers.onTouchStart : undefined}
        data-testid={`floating-window-${id}-title-bar`}
      >
        <span className="select-none font-medium text-muted-foreground text-xs">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Close ${title}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Window content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
