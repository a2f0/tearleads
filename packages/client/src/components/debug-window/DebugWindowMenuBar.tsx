import {
  WindowControlBar,
  WindowMenuBar
} from '@tearleads/window-manager';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface DebugWindowMenuBarProps {
  onClose: () => void;
  controls?: ReactNode;
}

export function DebugWindowMenuBar({
  onClose,
  controls
}: DebugWindowMenuBarProps) {
  return (
    <div className="shrink-0">
      <WindowMenuBar>
        <DropdownMenu trigger="File">
          <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
        </DropdownMenu>
        <DropdownMenu trigger="View">
          <WindowOptionsMenuItem />
        </DropdownMenu>
      </div>
      <WindowControlBar>{controls}</WindowControlBar>
    </div>
  );
}
