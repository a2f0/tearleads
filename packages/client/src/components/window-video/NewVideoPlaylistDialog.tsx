import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVideoPlaylists } from '@/hooks/media';
import { useDialogAccessibility } from '@/hooks/ui';

interface NewVideoPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlaylistCreated?: (id: string, name: string) => void;
}

export function NewVideoPlaylistDialog({
  open,
  onOpenChange,
  onPlaylistCreated
}: NewVideoPlaylistDialogProps) {
  const [playlistName, setPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { createPlaylist } = useVideoPlaylists();
  const dialogRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useDialogAccessibility(
    dialogRef,
    open,
    isCreating,
    () => onOpenChange(false)
  );

  useEffect(() => {
    if (open) {
      setPlaylistName('');
    }
  }, [open]);

  const handleCreate = async () => {
    if (!playlistName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const id = await createPlaylist(playlistName.trim());
      onPlaylistCreated?.(id, playlistName.trim());
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create video playlist:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    if (isCreating) return;
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleCreate();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="new-video-playlist-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-video-playlist-dialog-title"
        data-testid="new-video-playlist-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="new-video-playlist-dialog-title"
          className="font-semibold text-lg"
        >
          New Video Playlist
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              type="text"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder="Playlist name"
              disabled={isCreating}
              data-testid="new-video-playlist-name-input"
              autoComplete="off"
              autoFocus
              className="text-base"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isCreating}
              data-testid="new-video-playlist-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating || !playlistName.trim()}
              data-testid="new-video-playlist-dialog-create"
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
