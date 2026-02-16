import businessesPackageJson from '@tearleads/businesses/package.json';
import { WindowMenuBar } from '@tearleads/window-manager';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

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
          closeLabel="Close"
        />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
