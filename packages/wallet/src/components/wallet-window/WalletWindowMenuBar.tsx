import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@client/components/ui/dropdown-menu';
import { AboutMenuItem } from '@client/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@client/components/window-menu/WindowOptionsMenuItem';
import { Plus, RefreshCw } from 'lucide-react';

interface WalletWindowMenuBarProps {
  onCreateItem: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function WalletWindowMenuBar({
  onCreateItem,
  onRefresh,
  onClose
}: WalletWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          icon={<Plus className="h-3 w-3" />}
          onClick={onCreateItem}
        >
          New Item
        </DropdownMenuItem>
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
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Wallet" version="0.0.1" closeLabel="Close" />
      </DropdownMenu>
    </div>
  );
}
