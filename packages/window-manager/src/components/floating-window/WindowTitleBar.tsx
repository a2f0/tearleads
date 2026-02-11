import { Copy, Minus, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { WindowDimensions } from './types.js';

interface DragHandlers {
  onMouseDown: (event: React.MouseEvent) => void;
  onTouchStart: (event: React.TouchEvent) => void;
}

interface WindowTitleBarProps {
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
  preMaximizeDimensions?:
    | {
        width: number;
        height: number;
        x: number;
        y: number;
      }
    | null
    | undefined;
}

export function WindowTitleBar({
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
  preMaximizeDimensions
}: WindowTitleBarProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Title bar for mouse/touch drag only
    <div
      className={cn(
        'flex h-7 shrink-0 items-center justify-between border-b bg-muted/50 px-2',
        isDesktop && !isMaximized && 'cursor-grab active:cursor-grabbing'
      )}
      ref={titleBarRef}
      onMouseDown={
        isDesktop && !isMaximized ? dragHandlers.onMouseDown : undefined
      }
      onTouchStart={
        isDesktop && !isMaximized ? dragHandlers.onTouchStart : undefined
      }
      onDoubleClick={isDesktop ? onToggleMaximize : undefined}
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
                if (preMaximizeDimensions) {
                  dimensions.preMaximizeDimensions = preMaximizeDimensions;
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
              onToggleMaximize();
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={isMaximized ? `Restore ${title}` : `Maximize ${title}`}
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
  );
}
