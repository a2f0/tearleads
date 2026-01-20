import { Columns2, Rows2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

interface ConsoleWindowMenuBarProps {
  onNewTab: () => void;
  onClose: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
}

export function ConsoleWindowMenuBar({
  onNewTab,
  onClose,
  onSplitHorizontal,
  onSplitVertical
}: ConsoleWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onNewTab}>New Tab</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={onSplitHorizontal}
          icon={<Rows2 className="h-3 w-3" />}
        >
          Split Horizontal
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onSplitVertical}
          icon={<Columns2 className="h-3 w-3" />}
        >
          Split Vertical
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <PreserveWindowStateMenuItem />
      </DropdownMenu>
    </div>
  );
}
