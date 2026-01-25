import { useState } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { usePreserveWindowState } from '@/hooks/usePreserveWindowState';
import { WindowStateSettingsDialog } from './WindowStateSettingsDialog';

export function PreserveWindowStateMenuItem() {
  const { preserveWindowState, setPreserveWindowState } =
    usePreserveWindowState();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <DropdownMenuItem
        onClick={() => setDialogOpen(true)}
        checked={preserveWindowState}
      >
        Preserve Window State
      </DropdownMenuItem>
      <WindowStateSettingsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        preserveWindowState={preserveWindowState}
        onSave={setPreserveWindowState}
      />
    </>
  );
}
