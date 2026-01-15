import { Music, Pause, Play, SkipBack, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAudioContext } from '@/audio';
import { Button } from '@/components/ui/button';

/**
 * Mini player that appears in the lower-right corner when audio is playing.
 * Only shows when navigating away from audio pages to avoid redundant controls.
 */
export function MiniPlayer() {
  const { t } = useTranslation('audio');
  const audio = useAudioContext();
  const location = useLocation();

  const isOnAudioPage = location.pathname.startsWith('/audio');

  // Don't render if no audio context, not playing, or on audio pages
  if (!audio || !audio.currentTrack || !audio.isPlaying || isOnAudioPage) {
    return null;
  }

  const { currentTrack, isPlaying, pause, resume, stop, seek } = audio;

  return (
    <div
      className="fixed right-4 bottom-24 z-50 flex w-64 items-center gap-3 rounded-lg border bg-background p-3 shadow-lg"
      style={{ right: 'max(1rem, env(safe-area-inset-right, 0px))' }}
      data-testid="mini-player"
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
    </div>
  );
}
