import { WindowContextMenu } from '@rapid/window-manager';
import { zIndex } from '@/constants/zIndex';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      overlayZIndex={zIndex.contextMenuOverlay}
      menuZIndex={zIndex.contextMenu}
      menuClassName="min-w-40 bg-background py-1 shadow-lg"
    >
      {children}
    </WindowContextMenu>
  );
}
