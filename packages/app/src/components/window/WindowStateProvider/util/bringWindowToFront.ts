import type { WindowEntry } from "../types";
import { getMaxWindowZIndex } from "./getMaxWindowZIndex";

export function bringWindowToFront(windows: WindowEntry[], id: string) {
  const target = windows.find((windowEntry) => windowEntry.id === id);
  if (!target) {
    return windows;
  }

  const topZIndex = getMaxWindowZIndex(windows);
  if (target.zIndex === topZIndex) {
    return windows;
  }

  return windows.map((windowEntry) => {
    if (windowEntry.id === target.id) {
      return { ...windowEntry, zIndex: topZIndex };
    }
    if (windowEntry.zIndex > target.zIndex) {
      return { ...windowEntry, zIndex: windowEntry.zIndex - 1 };
    }
    return windowEntry;
  });
}
