import { WindowContextMenu } from '@rapid/window-manager';
import { ListPlus } from 'lucide-react';

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
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="video-empty-space-context-menu-backdrop"
      menuTestId="video-empty-space-context-menu"
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
    </WindowContextMenu>
  );
}
