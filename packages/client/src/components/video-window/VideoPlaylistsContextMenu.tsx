import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleRename = () => {
    onRename(playlist);
    onClose();
  };

  const handleDelete = () => {
    onDelete(playlist);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
      style={{ left: x, top: y }}
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
  );
}
