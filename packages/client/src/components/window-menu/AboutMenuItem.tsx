import { useState } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAppVersion } from '@/hooks/useAppVersion';
import { AboutDialog } from './AboutDialog';

export interface AboutMenuItemProps {
  appName?: string;
  version?: string;
}

export function AboutMenuItem({ appName, version }: AboutMenuItemProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const hookVersion = useAppVersion();
  const displayVersion = version ?? hookVersion ?? 'Unknown';

  return (
    <>
      <DropdownMenuItem onClick={() => setDialogOpen(true)} preventClose>
        About
      </DropdownMenuItem>
      <AboutDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        version={displayVersion}
        appName={appName}
      />
    </>
  );
}
