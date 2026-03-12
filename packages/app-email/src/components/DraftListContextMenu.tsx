import { WindowContextMenu } from '@tearleads/window-manager';
import { FileEdit, Trash2 } from 'lucide-react';

interface DraftListContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function DraftListContextMenu({
  x,
  y,
  onClose,
  onEdit,
  onDelete
}: DraftListContextMenuProps) {
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="draft-list-context-menu-backdrop"
      menuTestId="draft-list-context-menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onEdit();
          onClose();
        }}
      >
        <FileEdit className="h-4 w-4" />
        Edit
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>
    </WindowContextMenu>
  );
}
