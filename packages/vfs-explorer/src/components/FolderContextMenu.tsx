import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useVfsExplorerContext } from '../context';
import type { VfsFolderNode } from '../hooks';

interface FolderContextMenuProps {
  x: number;
  y: number;
  folder: VfsFolderNode;
  onClose: () => void;
  onNewSubfolder: (parentFolder: VfsFolderNode) => void;
  onRename: (folder: VfsFolderNode) => void;
  onDelete: (folder: VfsFolderNode) => void;
}

export function FolderContextMenu({
  x,
  y,
  folder,
  onClose,
  onNewSubfolder,
  onRename,
  onDelete
}: FolderContextMenuProps) {
  const {
    ui: { ContextMenu, ContextMenuItem, ContextMenuSeparator }
  } = useVfsExplorerContext();

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <ContextMenuItem
        icon={<FolderPlus className="h-4 w-4" />}
        onClick={() => {
          onNewSubfolder(folder);
          onClose();
        }}
      >
        New Subfolder
      </ContextMenuItem>
      <ContextMenuItem
        icon={<Pencil className="h-4 w-4" />}
        onClick={() => {
          onRename(folder);
          onClose();
        }}
      >
        Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<Trash2 className="h-4 w-4" />}
        onClick={() => {
          onDelete(folder);
          onClose();
        }}
      >
        Delete
      </ContextMenuItem>
    </ContextMenu>
  );
}
