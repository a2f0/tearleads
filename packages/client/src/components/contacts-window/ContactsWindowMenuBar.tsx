import { List, Table2, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

export type ViewMode = 'list' | 'table';

interface ContactsWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNewContact: () => void;
  onImportCsv: () => void;
  onClose: () => void;
  isNewContactDisabled?: boolean;
  isImportDisabled?: boolean;
}

export function ContactsWindowMenuBar({
  viewMode,
  onViewModeChange,
  onNewContact,
  onImportCsv,
  onClose,
  isNewContactDisabled = false,
  isImportDisabled = false
}: ContactsWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          onClick={onNewContact}
          disabled={isNewContactDisabled}
        >
          New
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Upload className="h-3 w-3" />}
          onClick={onImportCsv}
          disabled={isImportDisabled}
        >
          Import CSV
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
