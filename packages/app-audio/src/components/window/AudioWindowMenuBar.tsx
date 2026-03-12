import audioPackageJson from '@tearleads/app-audio/package.json';
import {
  AboutMenuItem,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem
} from '@tearleads/ui';
import { WindowMenuBar } from '@tearleads/window-manager';
import { Eye, EyeOff, Upload } from 'lucide-react';

export type AudioViewMode = 'list' | 'table';

interface AudioWindowMenuBarProps {
  onClose: () => void;
  onUpload: () => void;
  showDeleted: boolean;
  onShowDeletedChange: (show: boolean) => void;
  showDropzone: boolean;
  onShowDropzoneChange: (show: boolean) => void;
  view: AudioViewMode;
  onViewChange: (view: AudioViewMode) => void;
}

export function AudioWindowMenuBar({
  onClose,
  onUpload,
  showDeleted,
  onShowDeletedChange,
  showDropzone,
  onShowDropzoneChange,
  view,
  onViewChange
}: AudioWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          icon={<Upload className="h-3 w-3" />}
          onClick={onUpload}
        >
          Upload
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Audio" version={audioPackageJson.version} />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
