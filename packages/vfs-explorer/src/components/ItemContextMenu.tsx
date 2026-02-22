import {
  WindowContextMenu,
  WindowContextMenuItem
} from '@tearleads/window-manager';
import {
  ClipboardCopy,
  Copy,
  Download,
  ExternalLink,
  Share2
} from 'lucide-react';
import { useVfsClipboard, useVfsExplorerContext } from '../context';
import type { DisplayItem } from '../lib';

type ContextMenuItemType = 'cut' | 'copy' | 'share';

interface ItemContextMenuProps {
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
  const createActionHandler = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <WindowContextMenu x={x} y={y} onClose={onClose}>
      <WindowContextMenuItem
        icon={<ExternalLink className="h-4 w-4" />}
        onClick={createActionHandler(() => onOpen(item))}
      >
        Open
      </WindowContextMenuItem>
      <WindowContextMenuItem
        icon={<Download className="h-4 w-4" />}
        onClick={createActionHandler(() => onDownload(item))}
      >
        Download
      </WindowContextMenuItem>
      <div className="my-1 h-px bg-border" />
      {!hiddenItems.includes('cut') && (
        <WindowContextMenuItem
          icon={<ClipboardCopy className="h-4 w-4" />}
          onClick={createActionHandler(() => cut([clipboardItem]))}
        >
          Cut
        </WindowContextMenuItem>
      )}
      <WindowContextMenuItem
        icon={<Copy className="h-4 w-4" />}
        onClick={createActionHandler(() => copy([clipboardItem]))}
      >
        Copy
      </WindowContextMenuItem>
      {vfsShareApi && onShare && (
        <>
          <div className="my-1 h-px bg-border" />
          <WindowContextMenuItem
            icon={<Share2 className="h-4 w-4" />}
            onClick={createActionHandler(() => onShare(item))}
          >
            Sharing
          </WindowContextMenuItem>
        </>
      )}
    </WindowContextMenu>
  );
}
