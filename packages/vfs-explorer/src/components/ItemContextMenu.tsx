import { Download, ExternalLink, Share2 } from 'lucide-react';
import { useVfsExplorerContext } from '../context';
import type { DisplayItem } from './VfsDetailsPanel';

export interface ItemContextMenuProps {
  x: number;
  y: number;
  item: DisplayItem;
  onClose: () => void;
  onOpen: (item: DisplayItem) => void;
  onDownload: (item: DisplayItem) => void;
  onShare?: ((item: DisplayItem) => void) | undefined;
}

export function ItemContextMenu({
  x,
  y,
  item,
  onClose,
  onOpen,
  onDownload,
  onShare
}: ItemContextMenuProps) {
  const {
    ui: { ContextMenu, ContextMenuItem, ContextMenuSeparator },
    vfsShareApi
  } = useVfsExplorerContext();

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <ContextMenuItem
        icon={<ExternalLink className="h-4 w-4" />}
        onClick={() => {
          onOpen(item);
          onClose();
        }}
      >
        Open
      </ContextMenuItem>
      <ContextMenuItem
        icon={<Download className="h-4 w-4" />}
        onClick={() => {
          onDownload(item);
          onClose();
        }}
      >
        Download
      </ContextMenuItem>
      {vfsShareApi && onShare && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<Share2 className="h-4 w-4" />}
            onClick={() => {
              onShare(item);
              onClose();
            }}
          >
            Sharing
          </ContextMenuItem>
        </>
      )}
    </ContextMenu>
  );
}
