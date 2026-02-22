import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDialogAccessibility } from '@/hooks/ui';
import type { VideoPlaylist } from '@/video/VideoPlaylistContext';

interface RenameVideoPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: VideoPlaylist | null;
  onRename: (playlistId: string, newName: string) => Promise<void>;
  onPlaylistRenamed?: () => void;
}

export function RenameVideoPlaylistDialog({
  open,
  onOpenChange,
  playlist,
  onRename,
  onPlaylistRenamed
}: RenameVideoPlaylistDialogProps) {
  const [newName, setNewName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useDialogAccessibility(
    dialogRef,
    open,
    isRenaming,
    () => onOpenChange(false)
  );

  useEffect(() => {
    if (open && playlist) {
      setNewName(playlist.name);
    }
  }, [open, playlist]);

  const handleRename = async () => {
    if (!playlist || !newName.trim() || isRenaming) return;

    setIsRenaming(true);
    try {
      await onRename(playlist.id, newName.trim());
      onPlaylistRenamed?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to rename video playlist:', error);
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
        data-testid="rename-video-playlist-dialog-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-video-playlist-dialog-title"
        data-testid="rename-video-playlist-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="rename-video-playlist-dialog-title"
          className="font-semibold text-lg"
        >
          Rename Playlist
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mt-4">
            <Input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Playlist name"
              disabled={isRenaming}
              data-testid="rename-video-playlist-name-input"
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
              data-testid="rename-video-playlist-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isRenaming || !newName.trim()}
              data-testid="rename-video-playlist-dialog-rename"
            >
              {isRenaming ? 'Renaming...' : 'Rename'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
