import { clearAllWindowDimensions } from '@/lib/windowDimensionsStorage';

const STORAGE_KEY = 'window-state-preserve';
const DEFAULT_PRESERVE = true;

let cachedValue: boolean | null = null;
const listeners = new Set<() => void>();

function parseStored(value: string | null): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function getPreserveWindowState(): boolean {
  if (cachedValue !== null) {
    return cachedValue;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = parseStored(stored);
    cachedValue = parsed ?? DEFAULT_PRESERVE;
  } catch (error) {
    console.warn('Failed to load window state preference:', error);
    cachedValue = DEFAULT_PRESERVE;
  }

  return cachedValue;
}

export function setPreserveWindowState(next: boolean): void {
  cachedValue = next;

  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch (error) {
    console.warn('Failed to save window state preference:', error);
  }

  if (!next) {
    clearAllWindowDimensions();
  }

  listeners.forEach((listener) => {
    listener();
  });
}

export function subscribePreserveWindowState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPreserveWindowState(): void {
  cachedValue = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear window state preference:', error);
  }
  listeners.forEach((listener) => {
    listener();
  });
}
