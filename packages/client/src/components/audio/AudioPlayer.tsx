/**
 * Combined audio player component with visualizer, controls, and volume.
 * Integrates playback controls, frequency visualizer, seek bar, and volume control.
 */

import {
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type AudioTrack, useAudio } from '@/audio';
import { useAudioAnalyser } from '@/audio/useAudioAnalyser';
import { Button } from '@/components/ui/button';
import { LCDBar } from './LCDBar';
import {
  BAR_COUNT,
  BAR_KEYS,
  getStoredVisibility,
  setStoredVisibility,
  VISUALIZER_HEIGHT,
  type VisualizerVisibility
} from './visualizer.utils';

export type { VisualizerVisibility } from './visualizer.utils';

interface AudioPlayerProps {
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

export function AudioPlayer({ tracks }: AudioPlayerProps) {
  const {
    audioElementRef,
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    play,
    pause,
    resume,
    seek,
    setVolume
  } = useAudio();

  const frequencyData = useAudioAnalyser(audioElementRef, isPlaying, BAR_COUNT);
  const [visualizerVisibility, setVisualizerVisibility] =
    useState<VisualizerVisibility>(getStoredVisibility);

  // Track seeking state to prevent garbled audio during drag
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track last non-zero volume for mute/unmute toggle
  const lastVolumeRef = useRef(1);

  const currentIndex = currentTrack
    ? tracks.findIndex((t) => t.id === currentTrack.id)
    : -1;

  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < tracks.length - 1;

  const handleToggleVisibility = useCallback(() => {
    const newVisibility =
      visualizerVisibility === 'visible' ? 'hidden' : 'visible';
    setVisualizerVisibility(newVisibility);
    setStoredVisibility(newVisibility);
  }, [visualizerVisibility]);

  // Handle seek start - pause updates and track drag value
  const handleSeekStart = useCallback(() => {
    setIsSeeking(true);
    setSeekValue(currentTime);
  }, [currentTime]);

  // Handle seek change - update visual position without seeking audio
  const handleSeekChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = Number.parseFloat(e.target.value);
      setSeekValue(time);

      // Clear any pending seek timeout
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }

      // Debounce actual seek to reduce garbling during drag
      seekTimeoutRef.current = setTimeout(() => {
        seek(time);
      }, 100);
    },
    [seek]
  );

  // Handle seek end - commit the final position
  const handleSeekEnd = useCallback(() => {
    // Clear any pending debounced seek
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = null;
    }
    // Commit final seek position
    seek(seekValue);
    setIsSeeking(false);
  }, [seek, seekValue]);

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

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setVolume(Number.parseFloat(e.target.value));
    },
    [setVolume]
  );

  const handleToggleMute = useCallback(() => {
    setVolume(volume > 0 ? 0 : lastVolumeRef.current);
  }, [volume, setVolume]);

  // Track last non-zero volume for restore on unmute
  useEffect(() => {
    if (volume > 0) {
      lastVolumeRef.current = volume;
    }
  }, [volume]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, []);

  if (!currentTrack) {
    return null;
  }

  // Use seek value during drag, otherwise use actual current time
  const displayTime = isSeeking ? seekValue : currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;
  const volumePercent = volume * 100;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid="audio-player"
    >
      {/* Visualizer - centered */}
      {visualizerVisibility === 'visible' && (
        <div className="flex items-end justify-center gap-1">
          {BAR_KEYS.map((key, barIndex) => {
            const value = isPlaying ? (frequencyData[barIndex] ?? 0) : 0;
            const normalizedHeight = value / 255;

            return (
              <div
                key={key}
                className="flex w-3 flex-col-reverse gap-0.5"
                style={{ height: `${VISUALIZER_HEIGHT}px` }}
              >
                <LCDBar normalizedHeight={normalizedHeight} />
              </div>
            );
          })}
        </div>
      )}

      {/* Seek bar */}
      <div className="flex items-center gap-2">
        <span
          className="w-10 text-muted-foreground text-xs tabular-nums"
          data-testid="audio-current-time"
        >
          {formatTime(displayTime)}
        </span>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={displayTime}
            onChange={handleSeekChange}
            onMouseDown={handleSeekStart}
            onMouseUp={handleSeekEnd}
            onTouchStart={handleSeekStart}
            onTouchEnd={handleSeekEnd}
            className="audio-slider-seek h-2 w-full cursor-pointer appearance-none rounded-full"
            style={
              {
                '--progress': `${progress}%`
              } as React.CSSProperties
            }
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

      {/* EQ toggle and playback controls - centered */}
      <div className="flex items-center justify-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleToggleVisibility}
          aria-label={
            visualizerVisibility === 'visible'
              ? 'Hide visualizer'
              : 'Show visualizer'
          }
          data-testid="visualizer-toggle"
        >
          <Sliders className="h-4 w-4 text-muted-foreground" />
        </Button>
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

      {/* Volume control - centered */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleToggleMute}
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
          data-testid="audio-mute-toggle"
        >
          {volume > 0 ? (
            <Volume2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <VolumeX className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={handleVolumeChange}
          className="audio-slider-volume h-3 w-24 cursor-pointer appearance-none"
          style={
            {
              '--progress': `${volumePercent}%`
            } as React.CSSProperties
          }
          aria-label="Volume"
          data-testid="audio-volume"
        />
      </div>
    </div>
  );
}
