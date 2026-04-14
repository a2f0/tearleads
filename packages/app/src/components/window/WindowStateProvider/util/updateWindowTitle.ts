import type { WindowEntry } from "../types";

export function updateWindowTitle(
  windows: WindowEntry[],
  id: string,
  title: string,
) {
  return windows.map((windowEntry) =>
    windowEntry.id === id ? { ...windowEntry, title } : windowEntry,
  );
}
