import { useRef, useState, useSyncExternalStore } from 'react';
import {
  DropdownMenuItem,
  useDropdownMenuContext
} from '../dropdown-menu/index.js';
import { WindowOptionsDialog } from './WindowOptionsDialog.js';

const PRESERVE_WINDOW_STATE_KEY = 'tearleads-preserve-window-state';
const preserveWindowStateListeners = new Set<() => void>();

function getPreserveWindowState(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return localStorage.getItem(PRESERVE_WINDOW_STATE_KEY) === 'true';
}

function setPreserveWindowState(value: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(PRESERVE_WINDOW_STATE_KEY, value ? 'true' : 'false');
  preserveWindowStateListeners.forEach((listener) => {
    listener();
  });
}

function subscribePreserveWindowState(callback: () => void): () => void {
  preserveWindowStateListeners.add(callback);

  if (typeof window !== 'undefined') {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PRESERVE_WINDOW_STATE_KEY) {
        callback();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      preserveWindowStateListeners.delete(callback);
      window.removeEventListener('storage', handleStorage);
    };
  }

  return () => {
    preserveWindowStateListeners.delete(callback);
  };
}

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
