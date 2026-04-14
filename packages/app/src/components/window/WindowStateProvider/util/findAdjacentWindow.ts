import type { WindowEntry, WindowMoveDirection } from "../types";

export function findAdjacentWindow(
  windows: WindowEntry[],
  target: WindowEntry,
  direction: WindowMoveDirection,
) {
  let candidate: WindowEntry | null = null;

  for (const windowEntry of windows) {
    if (direction === "forward") {
      if (windowEntry.zIndex <= target.zIndex) {
        continue;
      }
      if (!candidate || windowEntry.zIndex < candidate.zIndex) {
        candidate = windowEntry;
      }
      continue;
    }

    if (windowEntry.zIndex >= target.zIndex) {
      continue;
    }
    if (!candidate || windowEntry.zIndex > candidate.zIndex) {
      candidate = windowEntry;
    }
  }

  return candidate;
}
