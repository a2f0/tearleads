import {
  DropdownMenu,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

interface AdminWindowMenuBarProps {
  onClose: () => void;
}

export function AdminWindowMenuBar({ onClose }: AdminWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <PreserveWindowStateMenuItem />
      </DropdownMenu>
    </div>
  );
}
