import { Download, ExternalLink } from 'lucide-react';
import { useVfsExplorerContext } from '../context';
import type { DisplayItem } from './VfsDetailsPanel';

export interface ItemContextMenuProps {
  x: number;
  y: number;
  item: DisplayItem;
  onClose: () => void;
  onOpen: (item: DisplayItem) => void;
  onDownload: (item: DisplayItem) => void;
}

export function ItemContextMenu({
  x,
  y,
  item,
  onClose,
  onOpen,
  onDownload
}: ItemContextMenuProps) {
  const {
    ui: { ContextMenu, ContextMenuItem }
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
    </ContextMenu>
  );
}
