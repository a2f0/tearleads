import {
  DropdownMenu,
  DropdownMenuItem,
  WindowOptionsMenuItem
} from '@tearleads/ui';
import { WindowMenuBar } from '@tearleads/window-manager';

interface HelpWindowMenuBarProps {
  onClose: () => void;
}

export function HelpWindowMenuBar({ onClose }: HelpWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
