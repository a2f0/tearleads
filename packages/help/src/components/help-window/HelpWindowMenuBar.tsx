import { WindowMenuBar } from '@tearleads/window-manager';
import { DropdownMenu, DropdownMenuItem } from '@tearleads/ui';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

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
