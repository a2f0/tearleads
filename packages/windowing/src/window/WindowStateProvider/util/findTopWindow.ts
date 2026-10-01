import type { WindowEntry } from "../types";

/** The highest-zIndex window matching `matches`, or null when none do. */
export function findTopWindow(
  windows: ReadonlyArray<WindowEntry>,
  matches: (windowEntry: WindowEntry) => boolean,
): WindowEntry | null {
  return windows.reduce<WindowEntry | null>(
    (top, candidate) =>
      matches(candidate) && (!top || candidate.zIndex > top.zIndex)
        ? candidate
        : top,
    null,
  );
}
