import { List, RefreshCw, Table2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

export type ViewMode = 'list' | 'table';

interface EmailWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function EmailWindowMenuBar({
  viewMode,
  onViewModeChange,
  onRefresh,
  onClose
}: EmailWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
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
        <PreserveWindowStateMenuItem />
      </DropdownMenu>
    </div>
  );
}
