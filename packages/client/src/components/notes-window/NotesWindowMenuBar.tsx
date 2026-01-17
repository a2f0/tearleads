import { List, Table2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';

export type ViewMode = 'list' | 'table';

interface NotesWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNewNote: () => void;
  onClose: () => void;
}

export function NotesWindowMenuBar({
  viewMode,
  onViewModeChange,
  onNewNote,
  onClose
}: NotesWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onNewNote}>New</DropdownMenuItem>
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
      </DropdownMenu>
    </div>
  );
}
