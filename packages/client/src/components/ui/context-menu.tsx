import { useEffect } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="fixed inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close context menu"
      />
      <div
        className="fixed z-10 min-w-40 rounded-md border bg-background py-1 shadow-lg"
        style={{ top: y, left: x }}
      >
        {children}
      </div>
    </div>
  );
}

interface ContextMenuItemProps {
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}

export function ContextMenuItem({
  icon,
  onClick,
  children
}: ContextMenuItemProps) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
