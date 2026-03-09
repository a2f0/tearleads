import { WindowContextMenu } from '@tearleads/window-manager';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import type { EmailFolder } from '../../types/folder.js';
import { canDeleteFolder, canRenameFolder } from '../../types/folder.js';

interface EmailFolderContextMenuProps {
  x: number;
  y: number;
  folder: EmailFolder;
  onClose: () => void;
  onCreateSubfolder: () => void;
  onRename: (folder: EmailFolder) => void;
  onDelete: (folder: EmailFolder) => void;
}

export function EmailFolderContextMenu({
  x,
  y,
  folder,
  onClose,
  onCreateSubfolder,
  onRename,
  onDelete
}: EmailFolderContextMenuProps) {
  const canRename = canRenameFolder(folder);
  const canDelete = canDeleteFolder(folder);

  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="email-folder-context-menu-backdrop"
      menuTestId="email-folder-context-menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onCreateSubfolder();
          onClose();
        }}
      >
        <FolderPlus className="h-4 w-4" />
        New Subfolder
      </button>
      {canRename && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onRename(folder);
            onClose();
          }}
        >
          <Pencil className="h-4 w-4" />
          Rename
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => {
            onDelete(folder);
            onClose();
          }}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      )}
    </WindowContextMenu>
  );
}
