// component-complexity: allow — title bar handles window chrome interactions (drag, resize, rename, context menu)

import { cn } from '@tearleads/ui';
import { Copy, Minus, Pencil, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { WindowContextMenu } from '../WindowContextMenu.js';
import { WindowContextMenuItem } from '../WindowContextMenuItem.js';
import type { WindowDimensions } from './types.js';

interface DragHandlers {
  onMouseDown: (event: React.MouseEvent) => void;
  onTouchStart: (event: React.TouchEvent) => void;
}

export interface WindowTitleBarProps {
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
  onRenameTitle?: ((nextTitle: string) => void) | undefined;
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
  preMaximizeDimensions,
  onRenameTitle
}: WindowTitleBarProps) {
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      return;
    }
    setDraftTitle(title);
  }, [isEditingTitle, title]);

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const closeContextMenu = () => {
    setMenuPosition(null);
  };

  const handleRename = () => {
    closeContextMenu();
    if (!onRenameTitle) return;
    setDraftTitle(title);
    setIsEditingTitle(true);
  };

  const commitTitleRename = () => {
    if (!onRenameTitle) {
      setIsEditingTitle(false);
      return;
    }
    const trimmedTitle = draftTitle.trim();
    if (trimmedTitle.length > 0 && trimmedTitle !== title) {
      onRenameTitle(trimmedTitle);
    }
    setIsEditingTitle(false);
  };

  const cancelTitleRename = () => {
    setDraftTitle(title);
    setIsEditingTitle(false);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Title bar for mouse/touch drag only */}
      <div
        className={cn(
          'flex h-7 shrink-0 items-center justify-between border-b bg-muted/50 px-2 [border-color:var(--soft-border)]',
          isDesktop &&
            !isMaximized &&
            !isEditingTitle &&
            'cursor-grab active:cursor-grabbing'
        )}
        ref={titleBarRef}
        onMouseDown={
          isDesktop && !isMaximized && !isEditingTitle
            ? dragHandlers.onMouseDown
            : undefined
        }
        onTouchStart={
          isDesktop && !isMaximized && !isEditingTitle
            ? dragHandlers.onTouchStart
            : undefined
        }
        onDoubleClick={
          isDesktop && !isEditingTitle ? onToggleMaximize : undefined
        }
        onContextMenu={openContextMenu}
        data-testid={`floating-window-${id}-title-bar`}
      >
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                commitTitleRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelTitleRename();
              }
            }}
            onBlur={commitTitleRename}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            className="h-5 rounded border bg-background px-1.5 font-medium text-base text-muted-foreground"
            aria-label={`Edit ${title} title`}
            data-testid={`floating-window-${id}-title-input`}
          />
        ) : (
          <span className="select-none font-medium text-muted-foreground text-xs">
            {title}
          </span>
        )}
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
              className="relative z-50 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
              className="relative z-50 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
            className="relative z-50 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Close ${title}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {menuPosition && (
        <WindowContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          onClose={closeContextMenu}
          menuTestId={`floating-window-${id}-title-bar-context-menu`}
          backdropTestId={`floating-window-${id}-title-bar-context-menu-backdrop`}
        >
          <WindowContextMenuItem
            icon={<Pencil className="h-4 w-4" />}
            onClick={handleRename}
            data-testid={`floating-window-${id}-rename-title-menu-item`}
          >
            Rename Window Title
          </WindowContextMenuItem>
        </WindowContextMenu>
      )}
    </>
  );
}
