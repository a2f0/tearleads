import { Eye, EyeOff, List, Table2 } from 'lucide-react';
import { useNotesUI } from '../context/NotesContext';
import { WindowMenuBar } from '@tearleads/window-manager';

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
  const {
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuSeparator,
    WindowOptionsMenuItem,
    AboutMenuItem
  } = useNotesUI();

  return (
    <WindowMenuBar>
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
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem />
      </DropdownMenu>
    </div>
  );
}
