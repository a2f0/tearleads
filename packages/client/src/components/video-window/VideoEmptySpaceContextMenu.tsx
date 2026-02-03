import { ListPlus } from 'lucide-react';
import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { zIndex } from '@/constants/zIndex';

interface VideoEmptySpaceContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onNewPlaylist: () => void;
}

export function VideoEmptySpaceContextMenu({
  x,
  y,
  onClose,
  onNewPlaylist
}: VideoEmptySpaceContextMenuProps) {
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  // Use portal to escape FloatingWindow's backdrop-filter containing block
  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: zIndex.floatingWindowContextMenuBackdrop }}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid="video-empty-space-context-menu-backdrop"
      />
      <div
        className="fixed min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
        style={{
          left: x,
          top: y,
          zIndex: zIndex.floatingWindowContextMenu
        }}
        data-testid="video-empty-space-context-menu"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={onNewPlaylist}
          data-testid="video-empty-space-context-menu-new-playlist"
        >
          <ListPlus className="h-4 w-4" />
          New Playlist
        </button>
      </div>
    </>,
    document.body
  );
}
