import { WindowContextMenu } from '@rapid/window-manager';
import { FolderPlus } from 'lucide-react';

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
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="empty-space-context-menu-backdrop"
      menuTestId="empty-space-context-menu"
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
    </WindowContextMenu>
  );
}
