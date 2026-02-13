import {
  DropdownMenu,
  DropdownMenuItem
} from '@client/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@client/components/window-menu/WindowOptionsMenuItem';

interface SyncWindowMenuBarProps {
  onClose: () => void;
}

export function SyncWindowMenuBar({ onClose }: SyncWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </div>
  );
}
