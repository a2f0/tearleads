import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AudioPlaylist,
  useAudioUIContext
} from '../../context/AudioUIContext';

interface DeletePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: AudioPlaylist | null;
  onDelete: (playlistId: string) => Promise<void>;
  onPlaylistDeleted?: (playlistId: string) => void;
}

export function DeletePlaylistDialog({
  open,
  onOpenChange,
  playlist,
  onDelete,
  onPlaylistDeleted
}: DeletePlaylistDialogProps) {
  const { ui } = useAudioUIContext();
  const { Button } = ui;
  const [isDeleting, setIsDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;
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

      if (e.key === 'Tab') {
        const focusableElements =
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (!firstElement || !lastElement) return;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    },
    [isDeleting, onOpenChange]
  );

  const handleDelete = async () => {
    if (!playlist || isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(playlist.id);
      onPlaylistDeleted?.(playlist.id);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to delete playlist:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    if (isDeleting) return;
    onOpenChange(false);
  };

  if (!open || !playlist) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="delete-playlist-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-playlist-dialog-title"
        data-testid="delete-playlist-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="delete-playlist-dialog-title" className="font-semibold text-lg">
          Delete Playlist
        </h2>
        <p className="mt-3 text-muted-foreground text-sm">
          Are you sure you want to delete "{playlist.name}"? This will remove
          the playlist but your audio files will not be deleted.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="delete-playlist-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="delete-playlist-dialog-delete"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
