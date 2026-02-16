import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { WindowMenuBar } from '@tearleads/window-manager';

interface TablesWindowMenuBarProps {
  onClose: () => void;
}

export function TablesWindowMenuBar({ onClose }: TablesWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
