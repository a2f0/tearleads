import { WindowContextMenu } from '@rapid/window-manager';
import {
  ClipboardCopy,
  Copy,
  Download,
  ExternalLink,
  Share2
} from 'lucide-react';
import { useVfsClipboard, useVfsExplorerContext } from '../context';
import type { DisplayItem } from './VfsDetailsPanel';

export type ContextMenuItemType = 'cut' | 'copy' | 'share';

export interface ItemContextMenuProps {
  x: number;
  y: number;
  item: DisplayItem;
  onClose: () => void;
  onOpen: (item: DisplayItem) => void;
  onDownload: (item: DisplayItem) => void;
  onShare?: ((item: DisplayItem) => void) | undefined;
  hiddenItems?: ContextMenuItemType[] | undefined;
}

export function ItemContextMenu({
  x,
  y,
  item,
  onClose,
  onOpen,
  onDownload,
  onShare,
  hiddenItems = []
}: ItemContextMenuProps) {
  const { vfsShareApi } = useVfsExplorerContext();
  const { cut, copy } = useVfsClipboard();

  const clipboardItem = {
    id: item.id,
    objectType: item.objectType,
    name: item.name
  };

  return (
    <WindowContextMenu x={x} y={y} onClose={onClose}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onOpen(item);
          onClose();
        }}
      >
        <ExternalLink className="h-4 w-4" />
        Open
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onDownload(item);
          onClose();
        }}
      >
        <Download className="h-4 w-4" />
        Download
      </button>
      <div className="my-1 h-px bg-border" />
      {!hiddenItems.includes('cut') && (
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
      {vfsShareApi && onShare && (
        <>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onShare(item);
              onClose();
            }}
          >
            <Share2 className="h-4 w-4" />
            Sharing
          </button>
        </>
      )}
    </WindowContextMenu>
  );
}
