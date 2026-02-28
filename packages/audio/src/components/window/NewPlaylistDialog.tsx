import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioUIContext } from '../../context/AudioUIContext';
import { handleDialogTabTrap } from './dialogFocusTrap';
import { useAudioPlaylists } from './useAudioPlaylists';

interface NewPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlaylistCreated?: (id: string, name: string) => void;
}

export function NewPlaylistDialog({
  open,
  onOpenChange,
  onPlaylistCreated
}: NewPlaylistDialogProps) {
  const { ui } = useAudioUIContext();
  const { Button, Input } = ui;
  const [playlistName, setPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { createPlaylist } = useAudioPlaylists();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setPlaylistName('');
      previousActiveElement.current = document.activeElement as HTMLElement;
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isCreating) {
        onOpenChange(false);
        return;
      }
      handleDialogTabTrap({
        event: e,
        containerRef: dialogRef,
        focusableSelector:
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      });
    },
    [isCreating, onOpenChange]
  );

  const handleCreate = async () => {
    if (!playlistName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const id = await createPlaylist(playlistName.trim());
      onPlaylistCreated?.(id, playlistName.trim());
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create playlist:', error);
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
        data-testid="new-playlist-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-playlist-dialog-title"
        data-testid="new-playlist-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="new-playlist-dialog-title" className="font-semibold text-lg">
          New Playlist
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              type="text"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder="Playlist name"
              disabled={isCreating}
              data-testid="new-playlist-name-input"
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
              data-testid="new-playlist-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating || !playlistName.trim()}
              data-testid="new-playlist-dialog-create"
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
