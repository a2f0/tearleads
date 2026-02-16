import { WindowMenuBar } from '@tearleads/window-manager';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';

interface DisplayPropertiesWindowMenuBarProps {
  onClose: () => void;
}

export function DisplayPropertiesWindowMenuBar({
  onClose
}: DisplayPropertiesWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
    </WindowMenuBar>
  );
}
