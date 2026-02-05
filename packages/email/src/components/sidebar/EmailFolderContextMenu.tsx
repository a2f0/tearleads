import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const canRename = canRenameFolder(folder);
  const canDelete = canDeleteFolder(folder);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
      style={{ left: x, top: y }}
      data-testid="email-folder-context-menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={onCreateSubfolder}
      >
        <FolderPlus className="h-4 w-4" />
        New Subfolder
      </button>
      {canRename && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => onRename(folder)}
        >
          <Pencil className="h-4 w-4" />
          Rename
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => onDelete(folder)}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      )}
    </div>
  );
}
