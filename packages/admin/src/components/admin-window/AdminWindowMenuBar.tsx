import { WindowControlBar } from '@tearleads/window-manager';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface AdminWindowMenuBarProps {
  onClose: () => void;
  controls?: ReactNode;
}

export function AdminWindowMenuBar({
  onClose,
  controls
}: AdminWindowMenuBarProps) {
  return (
    <div className="shrink-0">
      <div className="flex border-b bg-muted/30 px-1">
        <DropdownMenu trigger="File">
          <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
        </DropdownMenu>
        <DropdownMenu trigger="View">
          <WindowOptionsMenuItem />
        </DropdownMenu>
      </div>
      <WindowControlBar>
        <div data-testid="admin-window-controls">{controls}</div>
      </WindowControlBar>
    </div>
  );
}
