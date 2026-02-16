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
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Businesses" closeLabel="Close" />
      </DropdownMenu>
    </div>
  );
}
