import { Eye, EyeOff, List, Table2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

export type ViewMode = 'list' | 'table';

interface NotesWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  showListTableOptions: boolean;
  showDeleted: boolean;
  onShowDeletedChange: (show: boolean) => void;
  showMarkdownToolbarOption: boolean;
  showMarkdownToolbar: boolean;
  onToggleMarkdownToolbar: () => void;
  onNewNote: () => void;
  onClose: () => void;
}

export function NotesWindowMenuBar({
  viewMode,
  onViewModeChange,
  showListTableOptions,
  showDeleted,
  onShowDeletedChange,
  showMarkdownToolbarOption,
  showMarkdownToolbar,
  onToggleMarkdownToolbar,
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
        {showListTableOptions && (
          <>
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
              onClick={() => onShowDeletedChange(!showDeleted)}
              checked={showDeleted}
              icon={
                showDeleted ? (
                  <Eye className="h-3 w-3" />
                ) : (
                  <EyeOff className="h-3 w-3" />
                )
              }
            >
              Show Deleted
            </DropdownMenuItem>
          </>
        )}
        {showMarkdownToolbarOption && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onToggleMarkdownToolbar}
              checked={showMarkdownToolbar}
            >
              Markdown Toolbar
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <PreserveWindowStateMenuItem />
      </DropdownMenu>
    </div>
  );
}
