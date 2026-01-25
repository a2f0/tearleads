import { useState } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { usePreserveWindowState } from '@/hooks/usePreserveWindowState';
import { WindowOptionsDialog } from './WindowOptionsDialog';

export function WindowOptionsMenuItem() {
  const { preserveWindowState, setPreserveWindowState } =
    usePreserveWindowState();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <DropdownMenuItem onClick={() => setDialogOpen(true)} preventClose>
        Options
      </DropdownMenuItem>
      <WindowOptionsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        preserveWindowState={preserveWindowState}
        onSave={setPreserveWindowState}
      />
    </>
  );
}
