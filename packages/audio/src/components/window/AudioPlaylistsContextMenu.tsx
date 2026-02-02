import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { AudioPlaylist } from '../../context/AudioUIContext';

interface AudioPlaylistsContextMenuProps {
  x: number;
  y: number;
  playlist: AudioPlaylist;
  onClose: () => void;
  onRename: (playlist: AudioPlaylist) => void;
  onDelete: (playlist: AudioPlaylist) => void;
}

export function AudioPlaylistsContextMenu({
  x,
  y,
  playlist,
  onClose,
  onRename,
  onDelete
}: AudioPlaylistsContextMenuProps) {
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  // Use portal to escape FloatingWindow's backdrop-filter containing block
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[200]"
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid="playlist-context-menu-backdrop"
      />
      <div
        className="fixed z-[201] min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
        style={{ left: x, top: y }}
        data-testid="playlist-context-menu"
      >
        <button
          type="button"
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onRename(playlist);
            onClose();
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => {
            onDelete(playlist);
            onClose();
          }}
        >
          Delete
        </button>
      </div>
    </>,
    document.body
  );
}
