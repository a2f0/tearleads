import type { WindowInstance } from '@tearleads/window-manager';

const SNAPSHOT_KEY_PREFIX = 'window-snapshot';
const DIMENSIONS_KEY_PREFIX = 'window-dimensions';

function getSnapshotKey(instanceId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}:${instanceId}`;
}

function isValidWindowInstance(item: unknown): item is WindowInstance {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj['id'] === 'string' &&
    typeof obj['type'] === 'string' &&
    typeof obj['zIndex'] === 'number' &&
    typeof obj['isMinimized'] === 'boolean'
  );
}

export function saveWindowSnapshot(
  instanceId: string,
  windows: WindowInstance[]
): void {
  try {
    const key = getSnapshotKey(instanceId);
    localStorage.setItem(key, JSON.stringify(windows));
  } catch (error) {
    console.warn('Failed to save window snapshot:', error);
  }
}

export function loadWindowSnapshot(
  instanceId: string
): WindowInstance[] | null {
  try {
    const key = getSnapshotKey(instanceId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;

    const valid = parsed.filter(isValidWindowInstance);
    return valid.length > 0 ? valid : null;
  } catch (error) {
    console.warn('Failed to load window snapshot:', error);
    return null;
  }
}

export function clearWindowSnapshot(instanceId: string): void {
  try {
    const key = getSnapshotKey(instanceId);
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('Failed to clear window snapshot:', error);
  }
}

export function clearWindowDimensionsForInstance(instanceId: string): void {
  try {
    const prefix = `${DIMENSIONS_KEY_PREFIX}:${instanceId}:`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn('Failed to clear window dimensions for instance:', error);
  }
}

export function clearAllWindowSnapshots(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${SNAPSHOT_KEY_PREFIX}:`)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn('Failed to clear all window snapshots:', error);
  }
}
