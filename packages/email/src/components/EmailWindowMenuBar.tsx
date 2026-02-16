import { Edit, List, RefreshCw, Table2 } from 'lucide-react';
import { useEmailUI } from '../context';
import { WindowMenuBar } from '@tearleads/window-manager';

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
  const {
    AboutMenuItem,
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuSeparator,
    WindowOptionsMenuItem
  } = useEmailUI();

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
        <AboutMenuItem />
      </DropdownMenu>
    </div>
  );
}
