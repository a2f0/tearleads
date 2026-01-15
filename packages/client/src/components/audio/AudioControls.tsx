import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  SkipBack,
  SkipForward
} from 'lucide-react';
import { type CSSProperties, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type AudioTrack, type RepeatMode, useAudio } from '@/audio';
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
  const { t } = useTranslation('audio');
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    repeatMode,
    play,
    pause,
    resume,
    seek,
    cycleRepeatMode,
    setOnTrackEnd
  } = useAudio();

  const currentIndex = currentTrack
    ? tracks.findIndex((t) => t.id === currentTrack.id)
    : -1;

  const hasPrevious = currentIndex > 0;
  const hasNext =
    (currentIndex >= 0 && currentIndex < tracks.length - 1) ||
    (repeatMode === 'all' && tracks.length > 0);

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
    } else if (repeatMode === 'all') {
      // Wrap to first track in repeat-all mode
      const firstTrack = tracks[0];
      if (firstTrack) {
        play(firstTrack);
      }
    }
  }, [tracks, currentIndex, play, repeatMode]);

  // Handle track end based on repeat mode
  const handleTrackEnd = useCallback(() => {
    if (repeatMode === 'one') {
      // Replay current track
      seek(0);
      resume();
    } else if (repeatMode === 'all') {
      // Go to next track (will wrap to first)
      handleNext();
    }
    // repeatMode === 'off': do nothing, track just ends
  }, [repeatMode, seek, resume, handleNext]);

  // Register track end handler
  useEffect(() => {
    setOnTrackEnd(handleTrackEnd);
    return () => setOnTrackEnd(undefined);
  }, [setOnTrackEnd, handleTrackEnd]);

  const getRepeatTooltip = (mode: RepeatMode): string => {
    switch (mode) {
      case 'off':
        return t('repeatOff');
      case 'all':
        return t('repeatAll');
      case 'one':
        return t('repeatOne');
    }
  };

  if (!currentTrack) {
    return null;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const progressStyle: CSSProperties & { '--progress'?: string } = {
    '--progress': `${progress}%`
  };

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
            style={progressStyle}
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
          aria-label={t('previousTrack')}
          title={t('previousTrack')}
          data-testid="audio-previous"
        >
          <SkipBack />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRestart}
          aria-label={t('restart')}
          title={t('restart')}
          data-testid="audio-restart"
        >
          <RotateCcw />
        </Button>
        <Button
          variant="default"
          size="icon"
          onClick={handlePlayPause}
          aria-label={isPlaying ? t('pause') : t('play')}
          title={isPlaying ? t('pause') : t('play')}
          data-testid="audio-play-pause"
        >
          {isPlaying ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleNext}
          disabled={!hasNext}
          aria-label={t('nextTrack')}
          title={t('nextTrack')}
          data-testid="audio-next"
        >
          <SkipForward />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={cycleRepeatMode}
          aria-label={getRepeatTooltip(repeatMode)}
          title={getRepeatTooltip(repeatMode)}
          data-testid="audio-repeat"
          className={repeatMode !== 'off' ? 'text-primary' : undefined}
        >
          {repeatMode === 'one' ? <Repeat1 /> : <Repeat />}
        </Button>
      </div>
    </div>
  );
}
