import { handleDialogTabTrap } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AudioPlaylist,
  useAudioUIContext
} from '../../context/AudioUIContext';

interface RenamePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: AudioPlaylist | null;
  onRename: (playlistId: string, newName: string) => Promise<void>;
  onPlaylistRenamed?: (playlistId: string, newName: string) => void;
}

export function RenamePlaylistDialog({
  open,
  onOpenChange,
  playlist,
  onRename,
  onPlaylistRenamed
}: RenamePlaylistDialogProps) {
  const { ui } = useAudioUIContext();
  const { Button, Input } = ui;
  const [playlistName, setPlaylistName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && playlist) {
      setPlaylistName(playlist.name);
      previousActiveElement.current = document.activeElement as HTMLElement;
    } else if (!open) {
      previousActiveElement.current?.focus();
    }
  }, [open, playlist]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isRenaming) {
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
    [isRenaming, onOpenChange]
  );

  const handleRename = async () => {
    if (!playlist || !playlistName.trim() || isRenaming) return;
    if (playlistName.trim() === playlist.name) {
      onOpenChange(false);
      return;
    }

    setIsRenaming(true);
    try {
      await onRename(playlist.id, playlistName.trim());
      onPlaylistRenamed?.(playlist.id, playlistName.trim());
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to rename playlist:', error);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleCancel = () => {
    if (isRenaming) return;
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleRename();
  };

  if (!open || !playlist) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
        aria-hidden="true"
        data-testid="rename-playlist-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-playlist-dialog-title"
        data-testid="rename-playlist-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="rename-playlist-dialog-title" className="font-semibold text-lg">
          Rename Playlist
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              type="text"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder="Playlist name"
              disabled={isRenaming}
              data-testid="rename-playlist-name-input"
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
              disabled={isRenaming}
              data-testid="rename-playlist-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isRenaming || !playlistName.trim()}
              data-testid="rename-playlist-dialog-save"
            >
              {isRenaming ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
