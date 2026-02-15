import {
  Eye,
  EyeOff,
  Image,
  List,
  RefreshCw,
  Table2,
  Upload
} from 'lucide-react';
import { usePhotosUIContext } from '../../context';

export type ViewMode = 'list' | 'table' | 'thumbnail';

interface PhotosWindowMenuBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  showDeleted: boolean;
  onShowDeletedChange: (show: boolean) => void;
  showDropzone: boolean;
  onShowDropzoneChange: (show: boolean) => void;
  onRefresh: () => void;
  onUpload: () => void;
  onClose: () => void;
}

export function PhotosWindowMenuBar({
  viewMode,
  onViewModeChange,
  showDeleted,
  onShowDeletedChange,
  showDropzone,
  onShowDropzoneChange,
  onRefresh,
  onUpload,
  onClose
}: PhotosWindowMenuBarProps) {
  const { ui } = usePhotosUIContext();
  const {
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuSeparator,
    WindowOptionsMenuItem
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
          onClick={() => onViewModeChange('thumbnail')}
          checked={viewMode === 'thumbnail'}
          icon={<Image className="h-3 w-3" />}
        >
          Thumbnail
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
    </div>
  );
}
