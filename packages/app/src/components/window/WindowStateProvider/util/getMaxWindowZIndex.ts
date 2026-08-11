import type { WindowEntry } from "../types";

export function getMaxWindowZIndex(windows: ReadonlyArray<WindowEntry>) {
  return windows.reduce(
    (maxZIndex, windowEntry) => Math.max(maxZIndex, windowEntry.zIndex),
    0,
  );
}
