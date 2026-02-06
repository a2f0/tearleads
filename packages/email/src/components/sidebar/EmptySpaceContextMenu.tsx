import { FolderPlus } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { zIndex } from '../../constants/zIndex';

interface EmptySpaceContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onNewFolder: () => void;
}

export function EmptySpaceContextMenu({
  x,
  y,
  onClose,
  onNewFolder
}: EmptySpaceContextMenuProps) {
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Use portal to escape FloatingWindow's backdrop-filter containing block
  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: zIndex.floatingWindowContextMenuBackdrop }}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid="empty-space-context-menu-backdrop"
      />
      <div
        className="fixed min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
        style={{
          left: x,
          top: y,
          zIndex: zIndex.floatingWindowContextMenu
        }}
        data-testid="empty-space-context-menu"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onNewFolder();
            onClose();
          }}
        >
          <FolderPlus className="h-4 w-4" />
          New Folder
        </button>
      </div>
    </>,
    document.body
  );
}
