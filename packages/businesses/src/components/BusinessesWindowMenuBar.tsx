import { WindowMenuBar } from '@tearleads/window-manager';
import { useBusinesses } from '../context/BusinessesContext.js';

interface BusinessesWindowMenuBarProps {
  onClose: () => void;
}

export function BusinessesWindowMenuBar({
  onClose
}: BusinessesWindowMenuBarProps) {
  const { ui } = useBusinesses();
  const { DropdownMenu, DropdownMenuItem, AboutMenuItem } = ui;

  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Businesses" closeLabel="Close" />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
