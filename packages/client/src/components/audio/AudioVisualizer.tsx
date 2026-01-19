/**
 * Audio frequency visualizer component with waveform and gradient styles.
 * Displays bouncing bars that respond to audio frequency data.
 */

import { Sliders } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAudio } from '@/audio';
import { useAudioAnalyser } from '@/audio/useAudioAnalyser';
import { Button } from '@/components/ui/button';

export type VisualizerVisibility = 'visible' | 'hidden';

interface AudioVisualizerProps {
  visibility?: VisualizerVisibility;
  onVisibilityChange?: (visibility: VisualizerVisibility) => void;
}

const STORAGE_KEY = 'audio-visualizer-visible';
const BAR_COUNT = 12;
const SEGMENT_COUNT = 15;
const SEGMENT_TOTAL_HEIGHT = 6; // h-1 (4px) + gap-0.5 (2px)
const VISUALIZER_HEIGHT = SEGMENT_COUNT * SEGMENT_TOTAL_HEIGHT;

// Pre-generated stable keys for bars and segments (avoids array index key lint errors)
const BAR_KEYS = Array.from({ length: BAR_COUNT }, (_, i) => `bar-${i}`);
const SEGMENT_KEYS = Array.from(
  { length: SEGMENT_COUNT },
  (_, i) => `seg-${i}`
);

function getStoredVisibility(): VisualizerVisibility {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'visible' || stored === 'hidden') {
      return stored;
    }
  } catch {
    // localStorage may not be available
  }
  return 'visible';
}

function setStoredVisibility(visibility: VisualizerVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, visibility);
  } catch {
    // localStorage may not be available
  }
}

export function AudioVisualizer({
  visibility: controlledVisibility,
  onVisibilityChange
}: AudioVisualizerProps) {
  const { audioElementRef, isPlaying, currentTrack } = useAudio();
  const frequencyData = useAudioAnalyser(audioElementRef, isPlaying, BAR_COUNT);

  const [internalVisibility, setInternalVisibility] =
    useState<VisualizerVisibility>(getStoredVisibility);

  const visibility = controlledVisibility ?? internalVisibility;

  const handleToggleVisibility = useCallback(() => {
    const newVisibility = visibility === 'visible' ? 'hidden' : 'visible';
    if (onVisibilityChange) {
      onVisibilityChange(newVisibility);
    } else {
      setInternalVisibility(newVisibility);
      setStoredVisibility(newVisibility);
    }
  }, [visibility, onVisibilityChange]);

  useEffect(() => {
    if (controlledVisibility !== undefined) {
      setStoredVisibility(controlledVisibility);
    }
  }, [controlledVisibility]);

  // Only show when there's a track loaded
  if (!currentTrack) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-2 rounded-lg border bg-card p-3"
      data-testid="audio-visualizer"
    >
      {visibility === 'visible' && (
        <div className="flex flex-1 items-end justify-center gap-1">
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
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleToggleVisibility}
        aria-label={
          visibility === 'visible' ? 'Hide visualizer' : 'Show visualizer'
        }
        data-testid="visualizer-toggle"
      >
        <Sliders className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

interface BarProps {
  normalizedHeight: number;
}

function LCDBar({ normalizedHeight }: BarProps) {
  const activeSegments = Math.round(normalizedHeight * SEGMENT_COUNT);

  return (
    <>
      {SEGMENT_KEYS.map((key, segIndex) => {
        const isActive = segIndex < activeSegments;
        const segmentPosition = segIndex / SEGMENT_COUNT;

        let colorClass: string;
        if (segmentPosition > 0.8) {
          colorClass = isActive
            ? 'bg-destructive'
            : 'bg-destructive/20 dark:bg-destructive/30';
        } else if (segmentPosition > 0.6) {
          colorClass = isActive
            ? 'bg-accent-foreground dark:bg-accent'
            : 'bg-accent-foreground/20 dark:bg-accent/30';
        } else {
          colorClass = isActive
            ? 'bg-primary'
            : 'bg-primary/20 dark:bg-primary/30';
        }

        return (
          <div
            key={key}
            className={`h-1 w-full rounded-sm transition-colors duration-75 ${colorClass}`}
          />
        );
      })}
    </>
  );
}
