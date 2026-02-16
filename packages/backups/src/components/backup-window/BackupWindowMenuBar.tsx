import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { WindowMenuBar } from '@tearleads/window-manager';

interface BackupWindowMenuBarProps {
  onClose: () => void;
  onOpenDocumentation: () => void;
}

export function BackupWindowMenuBar({
  onClose,
  onOpenDocumentation
}: BackupWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
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
