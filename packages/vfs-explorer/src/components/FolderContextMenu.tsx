import {
  WindowContextMenu,
  WindowContextMenuItem
} from '@tearleads/window-manager';
import {
  Clipboard,
  ClipboardCopy,
  Copy,
  FolderPlus,
  Pencil,
  Share2,
  Trash2
} from 'lucide-react';
import { VFS_ROOT_ID } from '../constants';
import { useVfsClipboard, useVfsExplorerContext } from '../context';
import type { VfsFolderNode } from '../hooks';

interface FolderContextMenuProps {
  x: number;
  y: number;
  folder: VfsFolderNode;
  onClose: () => void;
  onNewSubfolder: (parentFolder: VfsFolderNode) => void;
  onRename: (folder: VfsFolderNode) => void;
  onDelete: (folder: VfsFolderNode) => void;
  onShare?: ((folder: VfsFolderNode) => void) | undefined;
  onPaste?: ((targetFolderId: string) => void) | undefined;
}

export function FolderContextMenu({
  x,
  y,
  folder,
  onClose,
  onNewSubfolder,
  onRename,
  onDelete,
  onShare,
  onPaste
}: FolderContextMenuProps) {
  const { vfsShareApi } = useVfsExplorerContext();
  const { cut, copy, hasItems } = useVfsClipboard();

  const clipboardItem = {
    id: folder.id,
    objectType: folder.objectType,
    name: folder.name
  };
  const isFolder = folder.objectType === 'folder';
  const isRootFolder = isFolder && folder.id === VFS_ROOT_ID;
  const canManageFolder = isFolder && !isRootFolder;
  const createActionHandler = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <WindowContextMenu x={x} y={y} onClose={onClose}>
      {isFolder && (
        <WindowContextMenuItem
          icon={<FolderPlus className="h-4 w-4" />}
          onClick={createActionHandler(() => onNewSubfolder(folder))}
        >
          New Subfolder
        </WindowContextMenuItem>
      )}
      {canManageFolder && (
        <WindowContextMenuItem
          icon={<Pencil className="h-4 w-4" />}
          onClick={createActionHandler(() => onRename(folder))}
        >
          Rename
        </WindowContextMenuItem>
      )}
      {canManageFolder && vfsShareApi && onShare && (
        <WindowContextMenuItem
          icon={<Share2 className="h-4 w-4" />}
          onClick={createActionHandler(() => onShare(folder))}
        >
          Sharing
        </WindowContextMenuItem>
      )}
      <div className="my-1 h-px bg-border" />
      {!isRootFolder && (
        <WindowContextMenuItem
          icon={<ClipboardCopy className="h-4 w-4" />}
          onClick={createActionHandler(() => cut([clipboardItem]))}
        >
          Cut
        </WindowContextMenuItem>
      )}
      {!isRootFolder && (
        <WindowContextMenuItem
          icon={<Copy className="h-4 w-4" />}
          onClick={createActionHandler(() => copy([clipboardItem]))}
        >
          Copy
        </WindowContextMenuItem>
      )}
      {hasItems && onPaste && (
        <WindowContextMenuItem
          icon={<Clipboard className="h-4 w-4" />}
          onClick={createActionHandler(() => onPaste(folder.id))}
        >
          Paste
        </WindowContextMenuItem>
      )}
      {canManageFolder && <div className="my-1 h-px bg-border" />}
      {canManageFolder && (
        <WindowContextMenuItem
          icon={<Trash2 className="h-4 w-4" />}
          variant="destructive"
          onClick={createActionHandler(() => onDelete(folder))}
        >
          Delete
        </WindowContextMenuItem>
      )}
    </WindowContextMenu>
  );
}
