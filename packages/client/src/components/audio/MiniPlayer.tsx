import { Copy, Music, Pause, Play, SkipBack, Square, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAudioContext } from '@/audio';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { FOOTER_HEIGHT } from '@/constants/layout';
import { useWindowManager } from '@/contexts/WindowManagerContext';

/**
 * Mini player that appears in the lower-right corner when audio is playing.
 * Only shows when navigating away from audio pages to avoid redundant controls.
 */
export function MiniPlayer() {
  const { t } = useTranslation('audio');
  const audio = useAudioContext();
  const location = useLocation();
  const { windows, openWindow, restoreWindow, updateWindowDimensions } =
    useWindowManager();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const audioWindow = useMemo(
    () => windows.find((w) => w.type === 'audio'),
    [windows]
  );

  const isOnAudioPage = location.pathname.startsWith('/audio');
  const isAudioWindowVisible = windows.some(
    (window) => window.type === 'audio' && !window.isMinimized
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRestore = useCallback(() => {
    if (audioWindow) {
      restoreWindow(audioWindow.id);
    } else {
      openWindow('audio');
    }
    setContextMenu(null);
  }, [audioWindow, openWindow, restoreWindow]);

  const handleMaximize = useCallback(() => {
    let windowId: string;
    if (audioWindow) {
      windowId = audioWindow.id;
    } else {
      windowId = openWindow('audio');
    }

    let preMaximizeDimensions = audioWindow?.dimensions?.preMaximizeDimensions;
    if (
      !preMaximizeDimensions &&
      audioWindow?.dimensions &&
      !audioWindow.dimensions.isMaximized
    ) {
      preMaximizeDimensions = {
        width: audioWindow.dimensions.width,
        height: audioWindow.dimensions.height,
        x: audioWindow.dimensions.x,
        y: audioWindow.dimensions.y
      };
    }

    updateWindowDimensions(windowId, {
      width: window.innerWidth,
      height: window.innerHeight - FOOTER_HEIGHT,
      x: 0,
      y: 0,
      isMaximized: true,
      ...(preMaximizeDimensions && { preMaximizeDimensions })
    });
    restoreWindow(windowId);
    setContextMenu(null);
  }, [audioWindow, openWindow, restoreWindow, updateWindowDimensions]);

  // Don't render if no audio context, not playing, on audio pages, or audio window is open
  if (
    !audio ||
    !audio.currentTrack ||
    !audio.isPlaying ||
    isOnAudioPage ||
    isAudioWindowVisible
  ) {
    return null;
  }

  const { currentTrack, isPlaying, pause, resume, stop, seek } = audio;

  return (
    <>
      <aside
        className="fixed right-4 bottom-24 z-50 flex w-64 items-center gap-3 rounded-lg border bg-background p-3 shadow-lg"
        style={{ right: 'max(1rem, env(safe-area-inset-right, 0px))' }}
        data-testid="mini-player"
        onContextMenu={handleContextMenu}
      >
        <Music className="h-8 w-8 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm" title={currentTrack.name}>
            {currentTrack.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => seek(0)}
            aria-label={t('rewind')}
            title={t('rewind')}
            data-testid="mini-player-rewind"
          >
            <SkipBack />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={isPlaying ? pause : resume}
            aria-label={isPlaying ? t('pause') : t('play')}
            title={isPlaying ? t('pause') : t('play')}
            data-testid="mini-player-play-pause"
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={stop}
            aria-label={t('close')}
            title={t('close')}
            data-testid="mini-player-close"
          >
            <X />
          </Button>
        </div>
      </aside>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Copy className="h-4 w-4" />}
            onClick={handleRestore}
          >
            Restore
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Square className="h-4 w-4" />}
            onClick={handleMaximize}
          >
            Maximize
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
