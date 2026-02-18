import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@tearleads/ui';
import { AboutMenuItem } from '@client/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@client/components/window-menu/WindowOptionsMenuItem';
import { WindowMenuBar } from '@tearleads/window-manager';
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
    <WindowMenuBar>
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
    </WindowMenuBar>
  );
}
