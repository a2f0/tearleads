import {
  Clipboard,
  ClipboardCopy,
  Copy,
  FolderPlus,
  Pencil,
  Share2,
  Trash2
} from 'lucide-react';
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
  const {
    ui: { ContextMenu, ContextMenuItem, ContextMenuSeparator },
    vfsShareApi
  } = useVfsExplorerContext();
  const { cut, copy, hasItems } = useVfsClipboard();

  const clipboardItem = {
    id: folder.id,
    objectType: 'folder' as const,
    name: folder.name
  };

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
      {vfsShareApi && onShare && (
        <ContextMenuItem
          icon={<Share2 className="h-4 w-4" />}
          onClick={() => {
            onShare(folder);
            onClose();
          }}
        >
          Sharing
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<ClipboardCopy className="h-4 w-4" />}
        onClick={() => {
          cut([clipboardItem]);
          onClose();
        }}
      >
        Cut
      </ContextMenuItem>
      <ContextMenuItem
        icon={<Copy className="h-4 w-4" />}
        onClick={() => {
          copy([clipboardItem]);
          onClose();
        }}
      >
        Copy
      </ContextMenuItem>
      {hasItems && onPaste && (
        <ContextMenuItem
          icon={<Clipboard className="h-4 w-4" />}
          onClick={() => {
            onPaste(folder.id);
            onClose();
          }}
        >
          Paste
        </ContextMenuItem>
      )}
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
