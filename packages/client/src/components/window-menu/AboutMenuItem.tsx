import { useState } from 'react';
import {
  DropdownMenuItem,
  useDropdownMenuContext
} from '@/components/ui/dropdown-menu';
import { useAppVersion } from '@/hooks/app';
import { AboutDialog } from './AboutDialog';

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
  const hookVersion = useAppVersion();
  const displayVersion = version ?? hookVersion ?? 'Unknown';

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
