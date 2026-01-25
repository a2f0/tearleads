import { Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface V86WindowMenuBarProps {
  showDropzone: boolean;
  onShowDropzoneChange: (show: boolean) => void;
  onUpload: () => void;
  onClose: () => void;
}

export function V86WindowMenuBar({
  showDropzone,
  onShowDropzoneChange,
  onUpload,
  onClose
}: V86WindowMenuBarProps) {
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
        <DropdownMenuItem
          onClick={() =>
            window.open('https://github.com/copy/v86', '_blank', 'noopener')
          }
        >
          v86 on GitHub
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            window.open('https://copy.sh/v86/', '_blank', 'noopener')
          }
        >
          v86 Demo
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
