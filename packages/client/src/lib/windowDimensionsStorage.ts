import type { WindowType } from '@/contexts/WindowManagerContext';

export interface StoredWindowDimensions {
  width: number;
  height: number;
  x: number;
  y: number;
}

const STORAGE_KEY_PREFIX = 'window-dimensions';

// Match FloatingWindow default minimums
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;

function getStorageKey(windowType: WindowType): string {
  return `${STORAGE_KEY_PREFIX}:${windowType}`;
}

export function saveWindowDimensions(
  windowType: WindowType,
  dimensions: StoredWindowDimensions
): void {
  try {
    const key = getStorageKey(windowType);
    localStorage.setItem(key, JSON.stringify(dimensions));
  } catch (error) {
    console.warn('Failed to save window dimensions:', error);
  }
}

export function loadWindowDimensions(
  windowType: WindowType
): StoredWindowDimensions | null {
  try {
    const key = getStorageKey(windowType);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as StoredWindowDimensions;

    // Validate the parsed data has required fields
    if (
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number' ||
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number'
    ) {
      return null;
    }

    // Clamp dimensions to viewport and enforce minimums
    const clampedWidth = Math.min(
      Math.max(MIN_WIDTH, parsed.width),
      window.innerWidth
    );
    const clampedHeight = Math.min(
      Math.max(MIN_HEIGHT, parsed.height),
      window.innerHeight
    );

    // Constrain position so window is fully visible
    const maxX = Math.max(0, window.innerWidth - clampedWidth);
    const maxY = Math.max(0, window.innerHeight - clampedHeight);

    return {
      width: clampedWidth,
      height: clampedHeight,
      x: Math.max(0, Math.min(parsed.x, maxX)),
      y: Math.max(0, Math.min(parsed.y, maxY))
    };
  } catch (error) {
    console.warn('Failed to load window dimensions:', error);
    return null;
  }
}

export function clearWindowDimensions(windowType: WindowType): void {
  try {
    const key = getStorageKey(windowType);
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('Failed to clear window dimensions:', error);
  }
}

export function clearAllWindowDimensions(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn('Failed to clear all window dimensions:', error);
  }
}
