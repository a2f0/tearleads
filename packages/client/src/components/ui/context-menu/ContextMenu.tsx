import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      // Adjust horizontal position if menu overflows right edge
      if (x + rect.width > viewportWidth) {
        adjustedX = Math.max(0, viewportWidth - rect.width - 8);
      }

      // Adjust vertical position if menu overflows bottom edge
      if (y + rect.height > viewportHeight) {
        adjustedY = Math.max(0, viewportHeight - rect.height - 8);
      }

      setPosition({ top: adjustedY, left: adjustedX });
    }
  }, [x, y]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Use Portal to render outside FloatingWindow DOM tree
  // This fixes positioning issues caused by backdrop-blur creating a new containing block
  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <button
        type="button"
        className="fixed inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close context menu"
      />
      <div
        ref={menuRef}
        className="fixed z-[10000] min-w-40 rounded-md border bg-background py-1 shadow-lg"
        style={{ top: position.top, left: position.left }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
