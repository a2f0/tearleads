import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@tearleads/ui';
import { WindowOptionsMenuItem } from '@client/components/window-menu/WindowOptionsMenuItem';
import { WindowMenuBar } from '@tearleads/window-manager';
import { Columns2, Rows2 } from 'lucide-react';

interface ConsoleWindowMenuBarProps {
  onNewTab: () => void;
  onClose: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onOpenDocumentation: () => void;
}

export function ConsoleWindowMenuBar({
  onNewTab,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
  onOpenDocumentation
}: ConsoleWindowMenuBarProps) {
  return (
    <WindowMenuBar className="gap-0.5 py-0.5">
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
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <DropdownMenuItem onClick={onOpenDocumentation}>
          Documentation
        </DropdownMenuItem>
      </DropdownMenu>
    </WindowMenuBar>
  );
}
