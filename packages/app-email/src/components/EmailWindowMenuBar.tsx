import emailPackageJson from '@tearleads/app-email/package.json';
import {
  AboutMenuItem,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem
} from '@tearleads/ui';
import { WindowMenuBar } from '@tearleads/window-manager';
import { Edit, List, RefreshCw, Table2 } from 'lucide-react';

export type ViewMode = 'list' | 'table';

interface EmailWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onRefresh: () => void;
  onClose: () => void;
  onCompose: () => void;
}

export function EmailWindowMenuBar({
  viewMode,
  onViewModeChange,
  onRefresh,
  onClose,
  onCompose
}: EmailWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          onClick={onCompose}
          icon={<Edit className="h-3 w-3" />}
        >
          Compose
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onRefresh}
          icon={<RefreshCw className="h-3 w-3" />}
        >
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={() => onViewModeChange('list')}
          checked={viewMode === 'list'}
          icon={<List className="h-3 w-3" />}
        >
          List
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onViewModeChange('table')}
          checked={viewMode === 'table'}
          icon={<Table2 className="h-3 w-3" />}
        >
          Table
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Email" version={emailPackageJson.version} />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
