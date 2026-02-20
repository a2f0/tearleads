import { useRef, useState } from 'react';
import {
  DropdownMenuItem,
  useDropdownMenuContext
} from '@/components/ui/dropdown-menu';
import { usePreserveWindowState } from '@/hooks/window';
import { WindowOptionsDialog } from './WindowOptionsDialog';

export function WindowOptionsMenuItem() {
  const { preserveWindowState, setPreserveWindowState } =
    usePreserveWindowState();
  const dropdownMenu = useDropdownMenuContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      dropdownMenu?.close();
    }
  };

  return (
    <>
      <DropdownMenuItem
        ref={menuItemRef}
        onClick={handleOpenDialog}
        preventClose
      >
        Options
      </DropdownMenuItem>
      <WindowOptionsDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        preserveWindowState={preserveWindowState}
        onSave={setPreserveWindowState}
      />
    </>
  );
}
