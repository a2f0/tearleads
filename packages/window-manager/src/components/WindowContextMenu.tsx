import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils.js';

const DEFAULT_OVERLAY_Z_INDEX = 200;
const DEFAULT_MENU_Z_INDEX = 201;
const VIEWPORT_PADDING = 8;

export interface WindowContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
  menuClassName?: string | undefined;
  backdropTestId?: string | undefined;
  menuTestId?: string | undefined;
  overlayZIndex?: number | undefined;
  menuZIndex?: number | undefined;
}

export function WindowContextMenu({
  x,
  y,
  onClose,
  children,
  menuClassName,
  backdropTestId,
  menuTestId,
  overlayZIndex = DEFAULT_OVERLAY_Z_INDEX,
  menuZIndex = DEFAULT_MENU_Z_INDEX
}: WindowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menuElement = menuRef.current;
    if (!menuElement) return;

    const rect = menuElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > viewportWidth - VIEWPORT_PADDING) {
      adjustedX = Math.max(
        VIEWPORT_PADDING,
        viewportWidth - rect.width - VIEWPORT_PADDING
      );
    }

    if (y + rect.height > viewportHeight - VIEWPORT_PADDING) {
      adjustedY = Math.max(
        VIEWPORT_PADDING,
        viewportHeight - rect.height - VIEWPORT_PADDING
      );
    }

    setPosition({ left: adjustedX, top: adjustedY });
  }, [x, y]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: overlayZIndex }}>
      <button
        type="button"
        className="fixed inset-0 cursor-default"
        style={{ zIndex: overlayZIndex }}
        onClick={onClose}
        aria-label="Close context menu"
        data-testid={backdropTestId}
      />
      <div
        ref={menuRef}
        className={cn(
          'fixed min-w-[160px] rounded-md border bg-popover p-1 shadow-md',
          menuClassName
        )}
        style={{
          left: position.left,
          top: position.top,
          zIndex: menuZIndex
        }}
        data-testid={menuTestId}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
