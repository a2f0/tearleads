import { Copy, Music, Pause, Play, SkipBack, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAudioContext } from '@/audio';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { FOOTER_HEIGHT } from '@/constants/layout';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { useIsMobile } from '@/hooks/useIsMobile';

const MINI_PLAYER_WIDTH = 256; // w-64
const MINI_PLAYER_HEIGHT = 64; // p-3 (12px) * 2 + h-10 button (40px)
const MINI_PLAYER_MARGIN = 16;
const DRAG_THRESHOLD = 3;

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

  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: -1,
    top: -1
  });

  const elementRef = useRef<HTMLElement>(null);
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const startMouseXRef = useRef(0);
  const startMouseYRef = useRef(0);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  // Initialize position to bottom-right corner and clamp on resize
  useEffect(() => {
    if (isMobile) return;

    const computeDefault = () => ({
      left: window.innerWidth - MINI_PLAYER_WIDTH - MINI_PLAYER_MARGIN,
      top:
        window.innerHeight -
        FOOTER_HEIGHT -
        MINI_PLAYER_MARGIN -
        MINI_PLAYER_HEIGHT
    });

    setPosition(computeDefault());

    const handleResize = () => {
      setPosition((prev) => ({
        left: Math.max(
          0,
          Math.min(prev.left, window.innerWidth - MINI_PLAYER_WIDTH)
        ),
        top: Math.max(
          0,
          Math.min(prev.top, window.innerHeight - MINI_PLAYER_HEIGHT)
        )
      }));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile]);

  const audioWindow = useMemo(
    () => windows.find((w) => w.type === 'audio'),
    [windows]
  );

  const isOnAudioPage = location.pathname.startsWith('/audio');
  const isAudioWindowVisible = windows.some(
    (window) => window.type === 'audio' && !window.isMinimized
  );

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;

    const deltaX = e.clientX - startMouseXRef.current;
    const deltaY = e.clientY - startMouseYRef.current;

    if (
      !hasDraggedRef.current &&
      Math.abs(deltaX) + Math.abs(deltaY) > DRAG_THRESHOLD
    ) {
      hasDraggedRef.current = true;
    }

    if (!hasDraggedRef.current) return;

    const rect = elementRef.current?.getBoundingClientRect();
    const w = rect?.width || MINI_PLAYER_WIDTH;
    const h = rect?.height || MINI_PLAYER_HEIGHT;

    const newX = Math.max(
      0,
      Math.min(startXRef.current + deltaX, window.innerWidth - w)
    );
    const newY = Math.max(
      0,
      Math.min(startYRef.current + deltaY, window.innerHeight - h)
    );

    setPosition({ left: newX, top: newY });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (isMobile || !elementRef.current) return;

      // Don't initiate drag from buttons
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;

      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      startMouseXRef.current = e.clientX;
      startMouseYRef.current = e.clientY;

      const rect = elementRef.current.getBoundingClientRect();
      startXRef.current = rect.left;
      startYRef.current = rect.top;

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [isMobile, handleMouseMove, handleMouseUp]
  );

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (hasDraggedRef.current) return;
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

  const positionReady = !isMobile && position.left >= 0 && position.top >= 0;

  return (
    <>
      <aside
        ref={elementRef}
        className="fixed z-50 flex w-64 items-center gap-3 rounded-lg border bg-background p-3 shadow-lg"
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
