import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { WindowMenuBar } from '@tearleads/window-manager';

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
    </div>
  );
}
