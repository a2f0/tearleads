import backupsPackageJson from '@tearleads/backups/package.json';
import { AboutMenuItem, DropdownMenu, DropdownMenuItem } from '@tearleads/ui';
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
        <DropdownMenuItem onClick={() => undefined} disabled>
          Options
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <DropdownMenuItem onClick={onOpenDocumentation}>
          Documentation
        </DropdownMenuItem>
        <AboutMenuItem appName="Backups" version={backupsPackageJson.version} />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
