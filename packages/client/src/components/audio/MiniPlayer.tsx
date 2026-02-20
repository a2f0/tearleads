import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { Copy, Music, Pause, Play, SkipBack, Square, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAudioContext } from '@/audio';
import { Button } from '@/components/ui/button';
import { FOOTER_HEIGHT } from '@/constants/layout';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { useDraggable } from '@/hooks/dnd';
import { useIsMobile } from '@/hooks/useIsMobile';

const MINI_PLAYER_WIDTH = 224; // w-56
const MINI_PLAYER_HEIGHT = 56; // p-2 (8px) * 2 + h-8 button (32px)

/**
 * Mini player that appears in the lower-right corner when audio is playing.
 * Only shows when navigating away from audio pages to avoid redundant controls.
 * Draggable on desktop.
 */
export function MiniPlayer() {
  const { t } = useTranslation('audio');
  const audio = useAudioContext();
  const location = useLocation();
  const { windows, openWindow, restoreWindow, updateWindowDimensions } =
    useWindowManager();
  const isMobile = useIsMobile();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const { position, isPositioned, elementRef, handleMouseDown, wasDragged } =
    useDraggable({
      dimensions: { width: MINI_PLAYER_WIDTH, height: MINI_PLAYER_HEIGHT },
      bottomMargin: FOOTER_HEIGHT,
      enabled: !isMobile
    });

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
      if (wasDragged()) return;
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [wasDragged]
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

  const positionReady = !isMobile && isPositioned;

  return (
    <>
      <aside
        ref={elementRef}
        className="fixed z-50 flex w-56 items-center gap-2 rounded-md border bg-background p-2 shadow-lg"
        style={
          positionReady
            ? { left: position.left, top: position.top, cursor: 'grab' }
            : {
                right: 'max(1rem, env(safe-area-inset-right, 0px))',
                bottom: '6rem'
              }
        }
        data-testid="mini-player"
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      >
        <Music className="h-6 w-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-xs" title={currentTrack.name}>
            {currentTrack.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => seek(0)}
            aria-label={t('rewind')}
            title={t('rewind')}
            data-testid="mini-player-rewind"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={isPlaying ? pause : resume}
            aria-label={isPlaying ? t('pause') : t('play')}
            title={isPlaying ? t('pause') : t('play')}
            data-testid="mini-player-play-pause"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={stop}
            aria-label={t('close')}
            title={t('close')}
            data-testid="mini-player-close"
          >
            <X className="h-4 w-4" />
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
