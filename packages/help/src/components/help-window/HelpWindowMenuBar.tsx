import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
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
    </div>
  );
}
