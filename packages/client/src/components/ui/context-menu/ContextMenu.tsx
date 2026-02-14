import { DesktopContextMenu } from '@tearleads/window-manager';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  return (
    <DesktopContextMenu x={x} y={y} onClose={onClose}>
      {children}
    </DesktopContextMenu>
  );
}
