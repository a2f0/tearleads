import { Copy, Minus, Square, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cn } from '@tearleads/ui';
import { DesktopContextMenu } from './DesktopContextMenu.js';
import { DesktopContextMenuItem } from './DesktopContextMenuItem.js';

export interface DesktopTaskbarButtonProps {
  /** Unique identifier for the window */
  windowId: string;
  /** Window type for test ID generation */
  type: string;
  /** Icon to display in the button */
  icon: React.ReactNode;
  /** Label text to display */
  label: string;
  /** Whether this window is the active (focused) window */
  isActive: boolean;
  /** Whether this window is minimized */
  isMinimized?: boolean;
  /** Called when the button is clicked */
  onClick: () => void;
  /** Called when minimize is requested */
  onMinimize: () => void;
  /** Called when close is requested */
  onClose: () => void;
  /** Called when maximize is requested */
  onMaximize: () => void;
  /** Optional additional className */
  className?: string;
}

export function DesktopTaskbarButton({
  windowId,
  type,
  icon,
  label,
  isActive,
  isMinimized = false,
  onClick,
  onMinimize,
  onClose,
  onMaximize,
  className
}: DesktopTaskbarButtonProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRestore = useCallback(() => {
    onClick();
    setContextMenu(null);
  }, [onClick]);

  const handleMinimize = useCallback(() => {
    onMinimize();
    setContextMenu(null);
  }, [onMinimize]);

  const handleClose = useCallback(() => {
    onClose();
    setContextMenu(null);
  }, [onClose]);

  const handleMaximize = useCallback(() => {
    onMaximize();
    setContextMenu(null);
  }, [onMaximize]);

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={cn(
          'flex h-6 items-center gap-1.5 border px-2 text-xs leading-none transition-colors',
          isActive
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
          isMinimized && 'opacity-60',
          className
        )}
        data-testid={`taskbar-button-${type}`}
        data-minimized={isMinimized}
        data-window-id={windowId}
      >
        {icon}
        <span>{label}</span>
      </button>
      {contextMenu && (
        <DesktopContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          {isMinimized ? (
            <>
              <DesktopContextMenuItem
                icon={<Copy className="h-4 w-4" />}
                onClick={handleRestore}
              >
                Restore
              </DesktopContextMenuItem>
              <DesktopContextMenuItem
                icon={<Square className="h-4 w-4" />}
                onClick={handleMaximize}
              >
                Maximize
              </DesktopContextMenuItem>
            </>
          ) : (
            <DesktopContextMenuItem
              icon={<Minus className="h-4 w-4" />}
              onClick={handleMinimize}
            >
              Minimize
            </DesktopContextMenuItem>
          )}
          <DesktopContextMenuItem
            icon={<X className="h-4 w-4" />}
            onClick={handleClose}
          >
            Close
          </DesktopContextMenuItem>
        </DesktopContextMenu>
      )}
    </>
  );
}
