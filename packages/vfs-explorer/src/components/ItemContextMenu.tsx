import { WindowContextMenu, WindowContextMenuItem } from '@rapid/window-manager';
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
      <WindowContextMenuItem
        icon={<ExternalLink className="h-4 w-4" />}
        onClick={() => {
          onOpen(item);
          onClose();
        }}
      >
        Open
      </WindowContextMenuItem>
      <WindowContextMenuItem
        icon={<Download className="h-4 w-4" />}
        onClick={() => {
          onDownload(item);
          onClose();
        }}
      >
        Download
      </WindowContextMenuItem>
      <div className="my-1 h-px bg-border" />
      {!hiddenItems.includes('cut') && (
        <WindowContextMenuItem
          icon={<ClipboardCopy className="h-4 w-4" />}
          onClick={() => {
            cut([clipboardItem]);
            onClose();
          }}
        >
          Cut
        </WindowContextMenuItem>
      )}
      <WindowContextMenuItem
        icon={<Copy className="h-4 w-4" />}
        onClick={() => {
          copy([clipboardItem]);
          onClose();
        }}
      >
        Copy
      </WindowContextMenuItem>
      {vfsShareApi && onShare && (
        <>
          <div className="my-1 h-px bg-border" />
          <WindowContextMenuItem
            icon={<Share2 className="h-4 w-4" />}
            onClick={() => {
              onShare(item);
              onClose();
            }}
          >
            Sharing
          </WindowContextMenuItem>
        </>
      )}
    </WindowContextMenu>
  );
}
