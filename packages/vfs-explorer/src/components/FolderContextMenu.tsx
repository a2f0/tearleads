import { WindowContextMenu } from '@rapid/window-manager';
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
    objectType: 'folder' as const,
    name: folder.name
  };
  const isRootFolder = folder.id === VFS_ROOT_ID;

  return (
    <WindowContextMenu x={x} y={y} onClose={onClose}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onNewSubfolder(folder);
          onClose();
        }}
      >
        <FolderPlus className="h-4 w-4" />
        New Subfolder
      </button>
      {!isRootFolder && (
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
      {!isRootFolder && vfsShareApi && onShare && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onShare(folder);
            onClose();
          }}
        >
          <Share2 className="h-4 w-4" />
          Sharing
        </button>
      )}
      <div className="my-1 h-px bg-border" />
      {!isRootFolder && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            cut([clipboardItem]);
            onClose();
          }}
        >
          <ClipboardCopy className="h-4 w-4" />
          Cut
        </button>
      )}
      {!isRootFolder && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            copy([clipboardItem]);
            onClose();
          }}
        >
          <Copy className="h-4 w-4" />
          Copy
        </button>
      )}
      {hasItems && onPaste && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onPaste(folder.id);
            onClose();
          }}
        >
          <Clipboard className="h-4 w-4" />
          Paste
        </button>
      )}
      {!isRootFolder && <div className="my-1 h-px bg-border" />}
      {!isRootFolder && (
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
