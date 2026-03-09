/**
 * LCD-style visualizer bar component with colored segments.
 */

import {
  HIGH_LEVEL_THRESHOLD,
  MEDIUM_LEVEL_THRESHOLD,
  SEGMENT_COUNT,
  SEGMENT_KEYS
} from './visualizer.utils';

interface LCDBarProps {
  normalizedHeight: number;
}

export function LCDBar({ normalizedHeight }: LCDBarProps) {
  const activeSegments = Math.round(normalizedHeight * SEGMENT_COUNT);

  return (
    <>
      {SEGMENT_KEYS.map((key, segIndex) => {
        const isActive = segIndex < activeSegments;
        const segmentPosition = segIndex / SEGMENT_COUNT;

        let colorClass: string;
        if (segmentPosition > HIGH_LEVEL_THRESHOLD) {
          colorClass = isActive
            ? 'bg-destructive'
            : 'bg-destructive/20 dark:bg-destructive/30';
        } else if (segmentPosition > MEDIUM_LEVEL_THRESHOLD) {
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
