import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDialogAccessibility } from '@/hooks/ui';
import type { VideoPlaylist } from '@/video/VideoPlaylistContext';

export interface DeleteVideoPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: VideoPlaylist | null;
  onDelete: (playlistId: string) => Promise<void>;
  onPlaylistDeleted?: (playlistId: string) => void;
}

export function DeleteVideoPlaylistDialog({
  open,
  onOpenChange,
  playlist,
  onDelete,
  onPlaylistDeleted
}: DeleteVideoPlaylistDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useDialogAccessibility(
    dialogRef,
    open,
    isDeleting,
    () => onOpenChange(false)
  );

  const handleDelete = async () => {
    if (!playlist || isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(playlist.id);
      onPlaylistDeleted?.(playlist.id);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to delete video playlist:', error);
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
        data-testid="delete-video-playlist-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-video-playlist-dialog-title"
        data-testid="delete-video-playlist-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="delete-video-playlist-dialog-title"
          className="font-semibold text-lg"
        >
          Delete Playlist
        </h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Are you sure you want to delete &ldquo;{playlist.name}&rdquo;? This
          action cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="delete-video-playlist-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="delete-video-playlist-dialog-delete"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
