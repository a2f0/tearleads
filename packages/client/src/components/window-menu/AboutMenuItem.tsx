import { useState } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAppVersion } from '@/hooks/useAppVersion';
import { AboutDialog } from './AboutDialog';

export function AboutMenuItem() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const version = useAppVersion();

  return (
    <>
      <DropdownMenuItem onClick={() => setDialogOpen(true)} preventClose>
        About
      </DropdownMenuItem>
      <AboutDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        version={version ?? 'Unknown'}
      />
    </>
  );
}
