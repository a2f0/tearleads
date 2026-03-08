import { handleDialogTabTrap } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PhotoAlbum } from './usePhotoAlbums';

interface DeleteAlbumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  album: PhotoAlbum | null;
  onDelete: (albumId: string) => Promise<void>;
  onAlbumDeleted?: (albumId: string) => void;
}

export function DeleteAlbumDialog({
  open,
  onOpenChange,
  album,
  onDelete,
  onAlbumDeleted
}: DeleteAlbumDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTimeout(() => cancelButtonRef.current?.focus(), 0);
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
    if (!album || isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(album.id);
      onAlbumDeleted?.(album.id);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to delete album:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    if (isDeleting) return;
    onOpenChange(false);
  };

  if (!open || !album) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="delete-album-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-album-dialog-title"
        data-testid="delete-album-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="delete-album-dialog-title" className="font-semibold text-lg">
          Delete Album
        </h2>
        <p className="mt-4 text-muted-foreground text-sm">
          Are you sure you want to delete "{album.name}"? This will remove the
          album but your photos will not be deleted.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="delete-album-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="delete-album-dialog-delete"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
