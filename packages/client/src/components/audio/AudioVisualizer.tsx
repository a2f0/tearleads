/**
 * Audio frequency visualizer component with LCD-style bars.
 * Displays bouncing bars that respond to audio frequency data.
 */

import { Sliders } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAudio } from '@/audio';
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

interface AudioVisualizerProps {
  visibility?: VisualizerVisibility;
  onVisibilityChange?: (visibility: VisualizerVisibility) => void;
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
