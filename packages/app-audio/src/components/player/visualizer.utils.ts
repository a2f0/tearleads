/**
 * Shared visualizer utilities, types, and constants.
 */

export type VisualizerVisibility = 'visible' | 'hidden';

export const STORAGE_KEY = 'audio-visualizer-visible';
export const BAR_COUNT = 12;
export const SEGMENT_COUNT = 15;
export const SEGMENT_TOTAL_HEIGHT = 6;
export const VISUALIZER_HEIGHT = SEGMENT_COUNT * SEGMENT_TOTAL_HEIGHT;

// Color threshold constants for LCD bar segments
export const HIGH_LEVEL_THRESHOLD = 0.8;
export const MEDIUM_LEVEL_THRESHOLD = 0.6;

// Pre-generated stable keys for bars and segments (avoids array index key lint errors)
export const BAR_KEYS = Array.from({ length: BAR_COUNT }, (_, i) => `bar-${i}`);
export const SEGMENT_KEYS = Array.from(
  { length: SEGMENT_COUNT },
  (_, i) => `seg-${i}`
);

export function getStoredVisibility(): VisualizerVisibility {
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

export function setStoredVisibility(visibility: VisualizerVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, visibility);
  } catch {
    // localStorage may not be available
  }
}
