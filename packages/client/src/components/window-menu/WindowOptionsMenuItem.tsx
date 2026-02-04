import { WINDOW_FIT_CONTENT_EVENT } from '@rapid/window-manager';
import { useRef, useState } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { usePreserveWindowState } from '@/hooks/usePreserveWindowState';
import { WindowOptionsDialog } from './WindowOptionsDialog';

export function WindowOptionsMenuItem() {
  const { preserveWindowState, setPreserveWindowState } =
    usePreserveWindowState();
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);
  const windowElementRef = useRef<HTMLElement | null>(null);

  const handleOpenDialog = () => {
    windowElementRef.current =
      menuItemRef.current?.closest<HTMLElement>('.floating-window') ?? null;
    setDialogOpen(true);
  };

  const handleFitContent = () => {
    windowElementRef.current?.dispatchEvent(
      new CustomEvent(WINDOW_FIT_CONTENT_EVENT)
    );
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
        onOpenChange={setDialogOpen}
        preserveWindowState={preserveWindowState}
        onSave={setPreserveWindowState}
        onFitContent={handleFitContent}
      />
    </>
  );
}
