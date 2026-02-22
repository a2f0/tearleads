import {
  clearAllWindowDimensions as clearAllWindowDimensionsShared,
  clearWindowDimensions as clearWindowDimensionsShared,
  loadWindowDimensions as loadWindowDimensionsShared,
  type StoredWindowDimensions,
  saveWindowDimensions as saveWindowDimensionsShared
} from '@tearleads/window-manager';
import type { WindowType } from '@/contexts/WindowManagerContext';

export function saveWindowDimensions(
  windowType: WindowType,
  dimensions: StoredWindowDimensions
): void {
  saveWindowDimensionsShared(windowType, dimensions);
}

export function loadWindowDimensions(
  windowType: WindowType
): StoredWindowDimensions | null {
  return loadWindowDimensionsShared(windowType);
}

export function clearWindowDimensions(windowType: WindowType): void {
  clearWindowDimensionsShared(windowType);
}

export function clearAllWindowDimensions(): void {
  clearAllWindowDimensionsShared();
}
