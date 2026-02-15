import { useState } from 'react';
import { type PhotoAlbum, usePhotosUIContext } from '../../context';

export interface DeleteAlbumDialogProps {
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
  const { ui, logError } = usePhotosUIContext();
  const {
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
  } = ui;

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!album || isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(album.id);
      onAlbumDeleted?.(album.id);
      onOpenChange(false);
    } catch (error) {
      logError(
        'Failed to delete album',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (!album) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-album-dialog">
        <DialogHeader>
          <DialogTitle id="delete-album-dialog-title">Delete Album</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{album.name}"? This will remove the
            album but your photos will not be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
            data-testid="delete-album-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void handleDelete();
            }}
            disabled={isDeleting}
            data-testid="delete-album-dialog-delete"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
