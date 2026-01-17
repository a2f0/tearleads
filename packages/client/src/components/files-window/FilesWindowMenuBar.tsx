import { Eye, EyeOff, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';

interface FilesWindowMenuBarProps {
  showDeleted: boolean;
  onShowDeletedChange: (show: boolean) => void;
  onUpload: () => void;
  onClose: () => void;
}

export function FilesWindowMenuBar({
  showDeleted,
  onShowDeletedChange,
  onUpload,
  onClose
}: FilesWindowMenuBarProps) {
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
      </DropdownMenu>
    </div>
  );
}
