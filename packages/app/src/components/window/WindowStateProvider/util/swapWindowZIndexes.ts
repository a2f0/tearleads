import type { WindowEntry, WindowMoveDirection } from "../types";
import { findAdjacentWindow } from "./findAdjacentWindow";

export function swapWindowZIndexes(
  windows: WindowEntry[],
  id: string,
  direction: WindowMoveDirection,
) {
  const target = windows.find((windowEntry) => windowEntry.id === id);
  if (!target) {
    return windows;
  }

  const swapWith = findAdjacentWindow(windows, target, direction);
  if (!swapWith) {
    return windows;
  }

  return windows.map((windowEntry) => {
    if (windowEntry.id === target.id) {
      return { ...windowEntry, zIndex: swapWith.zIndex };
    }
    if (windowEntry.id === swapWith.id) {
      return { ...windowEntry, zIndex: target.zIndex };
    }
    return windowEntry;
  });
}
