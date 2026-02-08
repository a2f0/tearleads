import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ClassicContextMenuAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}

interface ClassicContextMenuProps {
  x: number;
  y: number;
  ariaLabel: string;
  onClose: () => void;
  actions: ClassicContextMenuAction[];
}

export function ClassicContextMenu({
  x,
  y,
  ariaLabel,
  onClose,
  actions
}: ClassicContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    if (!menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > viewportWidth) {
      adjustedX = Math.max(0, viewportWidth - rect.width - 8);
    }

    if (y + rect.height > viewportHeight) {
      adjustedY = Math.max(0, viewportHeight - rect.height - 8);
    }

    setPosition({ top: adjustedY, left: adjustedX });
  }, [x, y]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[10000]">
      <button
        type="button"
        className="fixed inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close context menu"
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        className="fixed z-[10001] min-w-32 rounded border bg-white py-1 shadow"
        style={{ top: position.top, left: position.left }}
      >
        {actions.map((action) => (
          <button
            key={action.ariaLabel}
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1 text-left text-sm hover:bg-zinc-100 disabled:text-zinc-400"
            disabled={action.disabled}
            onClick={() => {
              action.onClick();
              onClose();
            }}
            aria-label={action.ariaLabel}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
