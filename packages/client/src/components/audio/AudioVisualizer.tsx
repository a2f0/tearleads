/**
 * Audio frequency visualizer component with retro LCD and modern gradient styles.
 * Displays bouncing bars that respond to audio frequency data.
 */

import { Sliders } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAudio } from '@/audio';
import { useAudioAnalyser } from '@/audio/useAudioAnalyser';
import { Button } from '@/components/ui/button';

export type VisualizerStyle = 'lcd' | 'gradient';

interface AudioVisualizerProps {
  style?: VisualizerStyle;
  onStyleChange?: (style: VisualizerStyle) => void;
}

const STORAGE_KEY = 'audio-visualizer-style';
const BAR_COUNT = 12;
const SEGMENT_COUNT = 15;

// Pre-generated stable keys for bars and segments (avoids array index key lint errors)
const BAR_KEYS = Array.from({ length: BAR_COUNT }, (_, i) => `bar-${i}`);
const SEGMENT_KEYS = Array.from(
  { length: SEGMENT_COUNT },
  (_, i) => `seg-${i}`
);

function getStoredStyle(): VisualizerStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'lcd' || stored === 'gradient') {
      return stored;
    }
  } catch {
    // localStorage may not be available
  }
  return 'lcd';
}

function setStoredStyle(style: VisualizerStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // localStorage may not be available
  }
}

export function AudioVisualizer({
  style: controlledStyle,
  onStyleChange
}: AudioVisualizerProps) {
  const { audioElementRef, isPlaying } = useAudio();
  const frequencyData = useAudioAnalyser(audioElementRef, isPlaying, BAR_COUNT);

  const [internalStyle, setInternalStyle] =
    useState<VisualizerStyle>(getStoredStyle);

  const style = controlledStyle ?? internalStyle;

  const handleToggleStyle = useCallback(() => {
    const newStyle = style === 'lcd' ? 'gradient' : 'lcd';
    if (onStyleChange) {
      onStyleChange(newStyle);
    } else {
      setInternalStyle(newStyle);
      setStoredStyle(newStyle);
    }
  }, [style, onStyleChange]);

  useEffect(() => {
    if (controlledStyle !== undefined) {
      setStoredStyle(controlledStyle);
    }
  }, [controlledStyle]);

  if (!isPlaying) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-2 rounded-lg border bg-card p-3"
      data-testid="audio-visualizer"
    >
      <div className="flex flex-1 items-end justify-center gap-1">
        {BAR_KEYS.map((key, barIndex) => {
          const value = frequencyData[barIndex] ?? 0;
          const normalizedHeight = value / 255;

          return (
            <div
              key={key}
              className="flex w-3 flex-col-reverse gap-0.5"
              style={{ height: `${SEGMENT_COUNT * 6}px` }}
            >
              {style === 'lcd' ? (
                <LCDBar
                  normalizedHeight={normalizedHeight}
                  barIndex={barIndex}
                />
              ) : (
                <GradientBar
                  normalizedHeight={normalizedHeight}
                  barIndex={barIndex}
                />
              )}
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleToggleStyle}
        aria-label={`Switch to ${style === 'lcd' ? 'gradient' : 'LCD'} style`}
        data-testid="visualizer-style-toggle"
      >
        <Sliders className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

interface BarProps {
  normalizedHeight: number;
  barIndex: number;
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

function GradientBar({ normalizedHeight }: BarProps) {
  const height = Math.max(4, normalizedHeight * SEGMENT_COUNT * 6);

  return (
    <div
      className="w-full rounded-sm transition-all duration-75"
      style={{
        height: `${height}px`,
        background: 'linear-gradient(to top, var(--primary), var(--ring))'
      }}
    />
  );
}
