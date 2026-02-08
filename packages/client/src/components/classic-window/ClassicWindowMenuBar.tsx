import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface ClassicWindowMenuBarProps {
  onClose: () => void;
}

const NOOP = () => {};

export function ClassicWindowMenuBar({ onClose }: ClassicWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={NOOP}>New Entry</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Edit">
        <DropdownMenuItem onClick={NOOP} disabled>
          Undo
        </DropdownMenuItem>
        <DropdownMenuItem onClick={NOOP} disabled>
          Redo
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Tags">
        <DropdownMenuItem onClick={NOOP}>New Tag</DropdownMenuItem>
        <DropdownMenuItem onClick={NOOP} disabled>
          Rename Tag
        </DropdownMenuItem>
        <DropdownMenuItem onClick={NOOP} disabled>
          Delete Tag
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Entries">
        <DropdownMenuItem onClick={NOOP}>New Entry</DropdownMenuItem>
        <DropdownMenuItem onClick={NOOP} disabled>
          Rename Entry
        </DropdownMenuItem>
        <DropdownMenuItem onClick={NOOP} disabled>
          Delete Entry
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Classic" closeLabel="Close" />
      </DropdownMenu>
    </div>
  );
}
