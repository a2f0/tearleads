import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@client/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@client/components/window-menu/WindowOptionsMenuItem';
import { RefreshCw } from 'lucide-react';

interface KeychainWindowMenuBarProps {
  onRefresh: () => void;
  onClose: () => void;
}

export function KeychainWindowMenuBar({
  onRefresh,
  onClose
}: KeychainWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          icon={<RefreshCw className="h-3 w-3" />}
          onClick={onRefresh}
        >
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </div>
  );
}
