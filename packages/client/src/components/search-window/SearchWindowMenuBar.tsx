import { Eye, Table2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

export type SearchViewMode = 'view' | 'table';

interface SearchWindowMenuBarProps {
  viewMode: SearchViewMode;
  onViewModeChange: (mode: SearchViewMode) => void;
  onClose: () => void;
}

export function SearchWindowMenuBar({
  viewMode,
  onViewModeChange,
  onClose
}: SearchWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={() => onViewModeChange('table')}
          checked={viewMode === 'table'}
          icon={<Table2 className="h-3 w-3" />}
        >
          Table
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onViewModeChange('view')}
          checked={viewMode === 'view'}
          icon={<Eye className="h-3 w-3" />}
        >
          View
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </div>
  );
}
