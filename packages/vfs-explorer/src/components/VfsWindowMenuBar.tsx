import { FolderPlus, Link, List, RefreshCw, Table2 } from 'lucide-react';
import { useVfsExplorerContext } from '../context';
import type { VfsViewMode } from '../lib';
import { WindowMenuBar } from '@tearleads/window-manager';

export type { VfsViewMode };

interface VfsWindowMenuBarProps {
  viewMode: VfsViewMode;
  onViewModeChange: (mode: VfsViewMode) => void;
  onNewFolder: () => void;
  onLinkItem: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function VfsWindowMenuBar({
  viewMode,
  onViewModeChange,
  onNewFolder,
  onLinkItem,
  onRefresh,
  onClose
}: VfsWindowMenuBarProps) {
  const {
    ui: {
      AboutMenuItem,
      DropdownMenu,
      DropdownMenuItem,
      DropdownMenuSeparator,
      WindowOptionsMenuItem
    }
  } = useVfsExplorerContext();

  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          icon={<FolderPlus className="h-3 w-3" />}
          onClick={onNewFolder}
        >
          New Folder
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Link className="h-3 w-3" />}
          onClick={onLinkItem}
        >
          Link Item...
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
        <DropdownMenuItem
          icon={<RefreshCw className="h-3 w-3" />}
          onClick={onRefresh}
        >
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem />
      </DropdownMenu>
    </div>
  );
}
