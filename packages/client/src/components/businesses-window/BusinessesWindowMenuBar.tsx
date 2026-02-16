import businessesPackageJson from '@tearleads/businesses/package.json';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
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
          closeLabel="Close"
        />
      </DropdownMenu>
    </div>
  );
}
