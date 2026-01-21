import { List, RefreshCw, Table2, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

export type ViewMode = 'list' | 'table';

interface DocumentsWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onUpload: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function DocumentsWindowMenuBar({
  viewMode,
  onViewModeChange,
  onUpload,
  onRefresh,
  onClose
}: DocumentsWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          icon={<Upload className="h-3 w-3" />}
          onClick={onUpload}
        >
          Upload
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
