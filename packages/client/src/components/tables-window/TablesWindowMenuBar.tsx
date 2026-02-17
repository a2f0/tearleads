import { WindowMenuBar } from '@tearleads/window-manager';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';

interface TablesWindowMenuBarProps {
  onClose: () => void;
}

export function TablesWindowMenuBar({ onClose }: TablesWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
    </WindowMenuBar>
  );
}
