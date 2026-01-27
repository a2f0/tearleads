import { FolderPlus, Link, List, RefreshCw, Table2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

export type VfsViewMode = 'list' | 'table';

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
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
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
    </div>
  );
}
