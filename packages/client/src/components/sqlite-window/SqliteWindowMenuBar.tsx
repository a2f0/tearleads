import { RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

interface SqliteWindowMenuBarProps {
  onClose: () => void;
  onRefresh: () => void;
}

export function SqliteWindowMenuBar({
  onClose,
  onRefresh
}: SqliteWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={onRefresh}
          icon={<RefreshCw className="h-3 w-3" />}
        >
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <PreserveWindowStateMenuItem />
      </DropdownMenu>
    </div>
  );
}
