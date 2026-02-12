import { WindowContextMenu } from '@tearleads/window-manager';
import { Info, Pause, Play, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { AudioWithUrl } from '../../context/AudioUIContext';

interface MenuPosition {
  x: number;
  y: number;
}

interface TrackContextMenuState extends MenuPosition {
  track: AudioWithUrl;
}

interface AudioListContextMenusProps {
  contextMenu: TrackContextMenuState | null;
  blankSpaceMenu: MenuPosition | null;
  currentTrackId?: string | undefined;
  isPlaying: boolean;
  onCloseContextMenu: () => void;
  onCloseBlankSpaceMenu: () => void;
  onContextMenuPlay: (track: AudioWithUrl) => void;
  onContextMenuInfo: () => void;
  onDelete: (track: AudioWithUrl) => void;
  onRestore: (track: AudioWithUrl) => void;
  onUpload?: (() => void) | undefined;
  labels: {
    restore: string;
    play: string;
    pause: string;
    getInfo: string;
    delete: string;
  };
}

export function AudioListContextMenus({
  contextMenu,
  blankSpaceMenu,
  currentTrackId,
  isPlaying,
  onCloseContextMenu,
  onCloseBlankSpaceMenu,
  onContextMenuPlay,
  onContextMenuInfo,
  onDelete,
  onRestore,
  onUpload,
  labels
}: AudioListContextMenusProps) {
  return (
    <>
      {contextMenu && (
        <WindowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={onCloseContextMenu}
        >
          {contextMenu.track.deleted ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => onRestore(contextMenu.track)}
            >
              <RotateCcw className="h-4 w-4" />
              {labels.restore}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => onContextMenuPlay(contextMenu.track)}
              >
                {contextMenu.track.id === currentTrackId && isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {contextMenu.track.id === currentTrackId && isPlaying
                  ? labels.pause
                  : labels.play}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={onContextMenuInfo}
              >
                <Info className="h-4 w-4" />
                {labels.getInfo}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => onDelete(contextMenu.track)}
              >
                <Trash2 className="h-4 w-4" />
                {labels.delete}
              </button>
            </>
          )}
        </WindowContextMenu>
      )}

      {blankSpaceMenu && onUpload && (
        <WindowContextMenu
          x={blankSpaceMenu.x}
          y={blankSpaceMenu.y}
          onClose={onCloseBlankSpaceMenu}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onUpload();
              onCloseBlankSpaceMenu();
            }}
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </WindowContextMenu>
      )}
    </>
  );
}
