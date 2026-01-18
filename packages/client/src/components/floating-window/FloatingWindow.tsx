import { Copy, Minus, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Corner } from '@/hooks/useFloatingWindow';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import { cn } from '@/lib/utils';

const DESKTOP_BREAKPOINT = 768;
const FOOTER_HEIGHT = 80;

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

export interface WindowDimensions {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized?: boolean;
  preMaximizeDimensions?: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
}

export interface FloatingWindowProps {
  id: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onMinimize?: ((dimensions: WindowDimensions) => void) | undefined;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  initialDimensions?: WindowDimensions | undefined;
  defaultWidth?: number | undefined;
  defaultHeight?: number | undefined;
  defaultX?: number | undefined;
  defaultY?: number | undefined;
  minWidth?: number | undefined;
  minHeight?: number | undefined;
  maxWidthPercent?: number | undefined;
  maxHeightPercent?: number | undefined;
  zIndex?: number | undefined;
  onFocus?: (() => void) | undefined;
}

interface PreMaximizeState {
  width: number;
  height: number;
  x: number;
  y: number;
}

export function FloatingWindow({
  id,
  title,
  children,
  onClose,
  onMinimize,
  onDimensionsChange,
  initialDimensions,
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
  const [isMaximized, setIsMaximized] = useState(
    initialDimensions?.isMaximized ?? false
  );
  const preMaximizeStateRef = useRef<PreMaximizeState | null>(
    initialDimensions?.preMaximizeDimensions ?? null
  );

  const effectiveDefaultWidth = initialDimensions?.width ?? defaultWidth;
  const effectiveDefaultHeight = initialDimensions?.height ?? defaultHeight;

  const {
    width,
    height,
    x,
    y,
    setDimensions,
    createCornerHandlers,
    createDragHandlers
  } = useFloatingWindow({
    defaultWidth: effectiveDefaultWidth,
    defaultHeight: effectiveDefaultHeight,
    defaultX:
      initialDimensions?.x ??
      defaultX ??
      (typeof window !== 'undefined'
        ? Math.max(50, (window.innerWidth - effectiveDefaultWidth) / 2)
        : 0),
    defaultY:
      initialDimensions?.y ??
      defaultY ??
      (typeof window !== 'undefined'
        ? Math.max(50, (window.innerHeight - effectiveDefaultHeight) / 2)
        : 0),
    minWidth,
    minHeight,
    maxWidthPercent,
    maxHeightPercent,
    onDimensionsChange
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

  const handleMaximize = useCallback(() => {
    if (isMaximized) {
      // Restore to previous size/position
      if (preMaximizeStateRef.current) {
        const {
          width: prevWidth,
          height: prevHeight,
          x: prevX,
          y: prevY
        } = preMaximizeStateRef.current;
        setDimensions(prevWidth, prevHeight, prevX, prevY);
        onDimensionsChange?.({
          width: prevWidth,
          height: prevHeight,
          x: prevX,
          y: prevY
        });
        preMaximizeStateRef.current = null;
      }
      setIsMaximized(false);
    } else {
      // Save current state and maximize (leaving space for footer/taskbar)
      preMaximizeStateRef.current = { width, height, x, y };
      const maxWidth = window.innerWidth;
      const maxHeight = window.innerHeight - FOOTER_HEIGHT;
      setDimensions(maxWidth, maxHeight, 0, 0);
      onDimensionsChange?.({ width: maxWidth, height: maxHeight, x: 0, y: 0 });
      setIsMaximized(true);
    }
  }, [isMaximized, width, height, x, y, setDimensions, onDimensionsChange]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Window focus on click
    <div
      className={cn(
        'fixed flex flex-col overflow-hidden border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80',
        isDesktop && !isMaximized && 'rounded-lg',
        !isDesktop && 'inset-x-0 bottom-0 rounded-t-lg'
      )}
      style={{
        zIndex,
        ...(isDesktop
          ? {
              width: `${width}px`,
              height: `${height}px`,
              left: `${x}px`,
              top: `${y}px`,
              ...(isMaximized
                ? {}
                : {
                    maxWidth: `${maxWidthPercent * 100}vw`,
                    maxHeight: `${maxHeightPercent * 100}vh`
                  })
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
      data-maximized={isMaximized}
    >
      {isDesktop && !isMaximized && (
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

      {/* Title bar - draggable on desktop when not maximized */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Title bar for mouse/touch drag only */}
      <div
        className={cn(
          'flex h-7 shrink-0 items-center justify-between border-b bg-muted/50 px-2',
          isDesktop && !isMaximized && 'cursor-grab active:cursor-grabbing'
        )}
        onMouseDown={
          isDesktop && !isMaximized ? dragHandlers.onMouseDown : undefined
        }
        onTouchStart={
          isDesktop && !isMaximized ? dragHandlers.onTouchStart : undefined
        }
        onDoubleClick={isDesktop ? handleMaximize : undefined}
        data-testid={`floating-window-${id}-title-bar`}
      >
        <span className="select-none font-medium text-muted-foreground text-xs">
          {title}
        </span>
        <div className="flex items-center gap-0.5">
          {onMinimize && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const dimensions: WindowDimensions = { width, height, x, y };
                if (isMaximized) {
                  dimensions.isMaximized = true;
                  if (preMaximizeStateRef.current) {
                    dimensions.preMaximizeDimensions =
                      preMaximizeStateRef.current;
                  }
                }
                onMinimize(dimensions);
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Minimize ${title}`}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          )}
          {isDesktop && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleMaximize();
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={
                isMaximized ? `Restore ${title}` : `Maximize ${title}`
              }
            >
              {isMaximized ? (
                <Copy className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Close ${title}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Window content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
