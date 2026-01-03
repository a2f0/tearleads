import { Music, Pause, Play, SkipBack, X } from 'lucide-react';
import { useAudioContext } from '@/audio';
import { Button } from '@/components/ui/button';

/**
 * Mini player that appears in the lower-right corner when audio is playing.
 * Persists across navigation to allow continuous playback.
 */
export function MiniPlayer() {
  const audio = useAudioContext();

  // Don't render if no audio context or no track
  if (!audio || !audio.currentTrack) {
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
          aria-label="Rewind"
          data-testid="mini-player-rewind"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={isPlaying ? pause : resume}
          aria-label={isPlaying ? 'Pause' : 'Play'}
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
          onClick={stop}
          aria-label="Close"
          data-testid="mini-player-close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
