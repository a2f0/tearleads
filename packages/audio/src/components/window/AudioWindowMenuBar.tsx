import { Upload } from 'lucide-react';
import { useAudioUIContext } from '../../context/AudioUIContext';

export type AudioViewMode = 'list' | 'table';

interface AudioWindowMenuBarProps {
  onClose: () => void;
  onUpload: () => void;
  showDropzone: boolean;
  onShowDropzoneChange: (show: boolean) => void;
  view: AudioViewMode;
  onViewChange: (view: AudioViewMode) => void;
}

export function AudioWindowMenuBar({
  onClose,
  onUpload,
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
        <DropdownMenuSeparator />
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem />
      </DropdownMenu>
    </div>
  );
}
