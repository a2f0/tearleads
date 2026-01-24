import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

interface V86WindowMenuBarProps {
  onClose: () => void;
}

export function V86WindowMenuBar({ onClose }: V86WindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <PreserveWindowStateMenuItem />
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
