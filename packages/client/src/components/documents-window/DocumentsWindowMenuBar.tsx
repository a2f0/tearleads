import { WindowMenuBar } from '@tearleads/window-manager';
import { Eye, EyeOff, List, RefreshCw, Table2, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

export type ViewMode = 'list' | 'table';

interface DocumentsWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  showDeleted: boolean;
  onShowDeletedChange: (show: boolean) => void;
  showDropzone: boolean;
  onShowDropzoneChange: (show: boolean) => void;
  onUpload: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function DocumentsWindowMenuBar({
  viewMode,
  onViewModeChange,
  showDeleted,
  onShowDeletedChange,
  showDropzone,
  onShowDropzoneChange,
  onUpload,
  onRefresh,
  onClose
}: DocumentsWindowMenuBarProps) {
  return (
    <WindowMenuBar>
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
        <DropdownMenuItem
          onClick={() => onShowDropzoneChange(!showDropzone)}
          checked={showDropzone}
          icon={<Upload className="h-3 w-3" />}
        >
          Show Dropzone
        </DropdownMenuItem>
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
        <DropdownMenuSeparator />
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
