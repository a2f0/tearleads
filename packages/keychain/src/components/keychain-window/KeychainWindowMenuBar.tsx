import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@client/components/ui/dropdown-menu';
import { AboutMenuItem } from '@client/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@client/components/window-menu/WindowOptionsMenuItem';
import keychainPackageJson from '@tearleads/keychain/package.json';
import { RefreshCw } from 'lucide-react';
import { WindowMenuBar } from '@tearleads/window-manager';

interface KeychainWindowMenuBarProps {
  onRefresh: () => void;
  onClose: () => void;
}

export function KeychainWindowMenuBar({
  onRefresh,
  onClose
}: KeychainWindowMenuBarProps) {
  return (
    <WindowMenuBar>
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
      <DropdownMenu trigger="Help">
        <AboutMenuItem
          appName="Keychain"
          version={keychainPackageJson.version}
          closeLabel="Close"
        />
      </DropdownMenu>
    </div>
  );
}
