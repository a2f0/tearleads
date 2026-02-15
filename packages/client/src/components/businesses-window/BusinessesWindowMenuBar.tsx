import businessesPackageJson from '@tearleads/businesses/package.json';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

interface BusinessesWindowMenuBarProps {
  onClose: () => void;
}

export function BusinessesWindowMenuBar({
  onClose
}: BusinessesWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
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
