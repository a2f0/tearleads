/**
 * Audio frequency visualizer component with waveform and gradient styles.
 * Displays bouncing bars that respond to audio frequency data.
 */

import { Sliders } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAudio } from '@/audio';
import { useAudioAnalyser } from '@/audio/useAudioAnalyser';
import { Button } from '@/components/ui/button';

export type VisualizerStyle = 'waveform' | 'gradient';

interface AudioVisualizerProps {
  style?: VisualizerStyle;
  onStyleChange?: (style: VisualizerStyle) => void;
}

const STORAGE_KEY = 'audio-visualizer-style';
const BAR_COUNT = 12;
const SEGMENT_COUNT = 15;
const SEGMENT_TOTAL_HEIGHT = 6; // h-1 (4px) + gap-0.5 (2px)
const VISUALIZER_HEIGHT = SEGMENT_COUNT * SEGMENT_TOTAL_HEIGHT;
const GRADIENT_BAR_MIN_HEIGHT = 4;
const WAVEFORM_BAR_MIN_HEIGHT = 2;

// Pre-generated stable keys for bars (avoids array index key lint errors)
const BAR_KEYS = Array.from({ length: BAR_COUNT }, (_, i) => `bar-${i}`);

function getStoredStyle(): VisualizerStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'waveform' || stored === 'gradient') {
      return stored;
    }
    if (stored === 'lcd') {
      return 'waveform';
    }
  } catch {
    // localStorage may not be available
  }
  return 'waveform';
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
  const { audioElementRef, isPlaying, currentTrack } = useAudio();
  const frequencyData = useAudioAnalyser(audioElementRef, isPlaying, BAR_COUNT);

  const [internalStyle, setInternalStyle] =
    useState<VisualizerStyle>(getStoredStyle);

  const style = controlledStyle ?? internalStyle;

  const handleToggleStyle = useCallback(() => {
    const newStyle = style === 'waveform' ? 'gradient' : 'waveform';
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

  // Only show when there's a track loaded
  if (!currentTrack) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-2 rounded-lg border bg-card p-3"
      data-testid="audio-visualizer"
    >
      <div className="flex flex-1 items-end justify-center gap-1">
        {BAR_KEYS.map((key, barIndex) => {
          // When not playing, show flatline (0 height)
          const value = isPlaying ? (frequencyData[barIndex] ?? 0) : 0;
          const normalizedHeight = value / 255;

          return (
            <div
              key={key}
              className="relative flex w-3 items-end justify-center"
              style={{ height: `${VISUALIZER_HEIGHT}px` }}
            >
              {style === 'waveform' ? (
                <WaveformBar normalizedHeight={normalizedHeight} />
              ) : (
                <GradientBar normalizedHeight={normalizedHeight} />
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
        aria-label={`Switch to ${style === 'waveform' ? 'gradient' : 'waveform'} style`}
        data-testid="visualizer-style-toggle"
      >
        <Sliders className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

interface BarProps {
  normalizedHeight: number;
}

function WaveformBar({ normalizedHeight }: BarProps) {
  const height = Math.max(
    WAVEFORM_BAR_MIN_HEIGHT,
    normalizedHeight * VISUALIZER_HEIGHT
  );

  return (
    <div
      className="absolute right-0 left-0 rounded-full transition-all duration-75"
      style={{
        height: `${height}px`,
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'linear-gradient(to top, var(--primary), var(--ring))',
        boxShadow: '0 0 6px var(--ring)'
      }}
    />
  );
}

function GradientBar({ normalizedHeight }: BarProps) {
  const height = Math.max(
    GRADIENT_BAR_MIN_HEIGHT,
    normalizedHeight * VISUALIZER_HEIGHT
  );

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
