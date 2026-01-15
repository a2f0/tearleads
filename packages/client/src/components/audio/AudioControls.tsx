import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback } from 'react';
import { type AudioTrack, useAudio } from '@/audio';
import { Button } from '@/components/ui/button';

interface AudioControlsProps {
  tracks: AudioTrack[];
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AudioControls({ tracks }: AudioControlsProps) {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    resume,
    seek
  } = useAudio();

  const currentIndex = currentTrack
    ? tracks.findIndex((t) => t.id === currentTrack.id)
    : -1;

  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < tracks.length - 1;

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = Number.parseFloat(e.target.value);
      seek(time);
    },
    [seek]
  );

  const handleRestart = useCallback(() => {
    seek(0);
  }, [seek]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [isPlaying, pause, resume]);

  const handlePrevious = useCallback(() => {
    const prevTrack = tracks[currentIndex - 1];
    if (prevTrack) {
      play(prevTrack);
    }
  }, [tracks, currentIndex, play]);

  const handleNext = useCallback(() => {
    const nextTrack = tracks[currentIndex + 1];
    if (nextTrack) {
      play(nextTrack);
    }
  }, [tracks, currentIndex, play]);

  if (!currentTrack) {
    return null;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid="audio-controls"
    >
      <div className="flex items-center gap-2">
        <span
          className="w-10 text-muted-foreground text-xs tabular-nums"
          data-testid="audio-current-time"
        >
          {formatTime(currentTime)}
        </span>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="audio-slider-seek h-2 w-full cursor-pointer appearance-none rounded-full"
            style={{
              '--progress': `${progress}%`
            }}
            aria-label="Seek"
            data-testid="audio-seekbar"
          />
        </div>
        <span
          className="w-10 text-right text-muted-foreground text-xs tabular-nums"
          data-testid="audio-duration"
        >
          {formatTime(duration)}
        </span>
      </div>

      <div className="flex items-center justify-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePrevious}
          disabled={!hasPrevious}
          aria-label="Previous track"
          data-testid="audio-previous"
        >
          <SkipBack />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRestart}
          aria-label="Restart track"
          data-testid="audio-restart"
        >
          <RotateCcw />
        </Button>
        <Button
          variant="default"
          size="icon"
          onClick={handlePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-testid="audio-play-pause"
        >
          {isPlaying ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleNext}
          disabled={!hasNext}
          aria-label="Next track"
          data-testid="audio-next"
        >
          <SkipForward />
        </Button>
      </div>
    </div>
  );
}
