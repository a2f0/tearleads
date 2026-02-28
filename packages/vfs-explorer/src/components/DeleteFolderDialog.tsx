import { useCallback, useEffect, useRef, useState } from 'react';
import { handleDialogTabTrap } from './dialogFocusTrap';
import { useVfsExplorerContext } from '../context';
import { useDeleteVfsFolder, type VfsFolderNode } from '../hooks';

interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: VfsFolderNode | null;
  onFolderDeleted?: (id: string) => void;
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folder,
  onFolderDeleted
}: DeleteFolderDialogProps) {
  const {
    ui: { Button }
  } = useVfsExplorerContext();
  const { deleteFolder, isDeleting } = useDeleteVfsFolder();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setErrorMessage(null);
      setTimeout(() => dialogRef.current?.focus(), 0);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onOpenChange(false);
        return;
      }
      handleDialogTabTrap({
        event: e,
        containerRef: dialogRef,
        focusableSelector:
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      });
    },
    [isDeleting, onOpenChange]
  );

  const handleDelete = async () => {
    if (isDeleting || !folder) return;
    setErrorMessage(null);

    try {
      await deleteFolder(folder.id);
      onFolderDeleted?.(folder.id);
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to delete folder'
      );
    }
  };

  const handleCancel = () => {
    if (isDeleting) return;
    onOpenChange(false);
  };

  if (!open || !folder) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="delete-folder-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-folder-dialog-title"
        aria-describedby="delete-folder-dialog-description"
        data-testid="delete-folder-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="delete-folder-dialog-title" className="font-semibold text-lg">
          Delete Folder
        </h2>
        <p
          id="delete-folder-dialog-description"
          className="mt-2 text-muted-foreground text-sm"
        >
          Are you sure you want to delete &quot;{folder.name}&quot;? Items in
          this folder will become unfiled.
        </p>
        {errorMessage && (
          <p
            className="mt-2 text-destructive text-sm"
            role="alert"
            data-testid="delete-folder-dialog-error"
          >
            {errorMessage}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="delete-folder-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="delete-folder-dialog-confirm"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
