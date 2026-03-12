import businessesPackageJson from '@tearleads/app-businesses/package.json';
import { AboutMenuItem, DropdownMenu, DropdownMenuItem } from '@tearleads/ui';
import { WindowMenuBar } from '@tearleads/window-manager';

interface BusinessesWindowMenuBarProps {
  onClose: () => void;
}

export function BusinessesWindowMenuBar({
  onClose
}: BusinessesWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem
          appName="Businesses"
          version={businessesPackageJson.version}
        />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
