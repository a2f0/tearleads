import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

export type AudioViewMode = 'list' | 'table';

interface AudioWindowMenuBarProps {
  onClose: () => void;
  view: AudioViewMode;
  onViewChange: (view: AudioViewMode) => void;
}

export function AudioWindowMenuBar({
  onClose,
  view,
  onViewChange
}: AudioWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={() => onViewChange('list')}
          checked={view === 'list'}
        >
          List View
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onViewChange('table')}
          checked={view === 'table'}
        >
          Table View
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <PreserveWindowStateMenuItem />
      </DropdownMenu>
    </div>
  );
}
