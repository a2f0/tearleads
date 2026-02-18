import {
  getPreserveWindowState,
  setPreserveWindowState,
  subscribePreserveWindowState
} from '@tearleads/window-manager';
import { useRef, useState, useSyncExternalStore } from 'react';
import {
  DropdownMenuItem,
  useDropdownMenuContext
} from '../dropdown-menu/index.js';
import { WindowOptionsDialog } from './WindowOptionsDialog.js';

export function WindowOptionsMenuItem() {
  const preserveWindowState = useSyncExternalStore(
    subscribePreserveWindowState,
    getPreserveWindowState,
    getPreserveWindowState
  );
  const dropdownMenu = useDropdownMenuContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      dropdownMenu?.close();
      menuItemRef.current?.focus();
    }
  };

  return (
    <>
      <DropdownMenuItem
        ref={menuItemRef}
        onClick={() => setDialogOpen(true)}
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
