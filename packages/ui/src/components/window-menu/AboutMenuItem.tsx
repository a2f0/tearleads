import { useState } from 'react';
import {
  DropdownMenuItem,
  useDropdownMenuContext
} from '../dropdown-menu/index.js';
import { AboutDialog } from './AboutDialog.js';

export interface AboutMenuItemProps {
  appName?: string;
  version?: string;
  closeLabel?: string;
}

export function AboutMenuItem({
  appName,
  version,
  closeLabel
}: AboutMenuItemProps) {
  const dropdownMenu = useDropdownMenuContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const displayVersion = version ?? 'Unknown';

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      dropdownMenu?.close();
    }
  };

  return (
    <>
      <DropdownMenuItem onClick={() => setDialogOpen(true)} preventClose>
        About
      </DropdownMenuItem>
      <AboutDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        version={displayVersion}
        appName={appName}
        closeLabel={closeLabel}
      />
    </>
  );
}
