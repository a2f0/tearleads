import { Pencil, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { zIndex } from '@/constants/zIndex';
import type { VideoPlaylist } from '@/video/VideoPlaylistContext';

interface VideoPlaylistsContextMenuProps {
  x: number;
  y: number;
  playlist: VideoPlaylist;
  onClose: () => void;
  onRename: (playlist: VideoPlaylist) => void;
  onDelete: (playlist: VideoPlaylist) => void;
}

export function VideoPlaylistsContextMenu({
  x,
  y,
  playlist,
  onClose,
  onRename,
  onDelete
}: VideoPlaylistsContextMenuProps) {
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleRename = () => {
    onRename(playlist);
    onClose();
  };

  const handleDelete = () => {
    onDelete(playlist);
    onClose();
  };

  // Use portal to escape FloatingWindow's backdrop-filter containing block
  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: zIndex.floatingWindowContextMenuBackdrop }}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid="video-playlist-context-menu-backdrop"
      />
      <div
        className="fixed min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
        style={{
          left: x,
          top: y,
          zIndex: zIndex.floatingWindowContextMenu
        }}
        data-testid="video-playlist-context-menu"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={handleRename}
          data-testid="video-playlist-context-menu-rename"
        >
          <Pencil className="h-4 w-4" />
          Rename
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
          onClick={handleDelete}
          data-testid="video-playlist-context-menu-delete"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </>,
    document.body
  );
}
