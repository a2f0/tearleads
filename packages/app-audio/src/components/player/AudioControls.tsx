/**
 * Audio playback controls component with seek bar and repeat mode.
 */

import {
  handleTrackEnd as applyTrackEndBehavior,
  getRepeatTooltipKey,
  getTrackIndexById,
  hasNextTrack,
  hasPreviousTrack,
  playNextTrack,
  playTrackAtIndex
} from '@tearleads/shared';
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
import { type AudioTrack, useAudio } from '../../context/AudioContext';
import { useAudioUI } from '../../context/AudioUIContext';

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

  const { Button } = useAudioUI();

  const currentIndex = getTrackIndexById(tracks, currentTrack);

  const hasPrevious = hasPreviousTrack(currentIndex);
  const hasNext = hasNextTrack(currentIndex, tracks.length, repeatMode);

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

  const togglePlayback = isPlaying ? pause : resume;

  const handlePlayPause = useCallback(() => {
    togglePlayback();
  }, [togglePlayback]);

  const handlePrevious = useCallback(() => {
    playTrackAtIndex({ tracks, index: currentIndex - 1, play });
  }, [tracks, currentIndex, play]);

  const handleNext = useCallback(() => {
    playNextTrack({
      tracks,
      currentIndex,
      repeatMode,
      play
    });
  }, [tracks, currentIndex, play, repeatMode]);

  const handleTrackEnd = useCallback(() => {
    applyTrackEndBehavior({
      repeatMode,
      seekToStart: () => seek(0),
      resumePlayback: resume,
      playNextTrack: handleNext
    });
  }, [repeatMode, seek, resume, handleNext]);

  // Register track end handler
  useEffect(() => {
    setOnTrackEnd(handleTrackEnd);
    return () => setOnTrackEnd(undefined);
  }, [setOnTrackEnd, handleTrackEnd]);

  const repeatTooltip = t(getRepeatTooltipKey(repeatMode));

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
          aria-label={repeatTooltip}
          title={repeatTooltip}
          data-testid="audio-repeat"
          className={repeatMode !== 'off' ? 'text-primary' : undefined}
        >
          {repeatMode === 'one' ? <Repeat1 /> : <Repeat />}
        </Button>
      </div>
    </div>
  );
}
