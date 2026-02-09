import { Eye, EyeOff, Upload } from 'lucide-react';
import { useAudioUIContext } from '../../context/AudioUIContext';

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
  const { ui } = useAudioUIContext();
  const {
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuSeparator,
    WindowOptionsMenuItem,
    AboutMenuItem
  } = ui;

  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
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
        <AboutMenuItem />
      </DropdownMenu>
    </div>
  );
}
