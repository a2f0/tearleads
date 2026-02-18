import { WindowMenuBar } from '@tearleads/window-manager';
import { DropdownMenu, DropdownMenuItem } from '@tearleads/ui';

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
        <DropdownMenuItem onClick={() => undefined} disabled>
          Options
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <DropdownMenuItem onClick={onOpenDocumentation}>
          Documentation
        </DropdownMenuItem>
      </DropdownMenu>
    </WindowMenuBar>
  );
}
