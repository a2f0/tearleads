import type { WindowEntry } from "../types";

export function updateWindowFlag(
  windows: WindowEntry[],
  id: string,
  patch: Pick<WindowEntry, "minimized">,
) {
  return windows.map((windowEntry) =>
    windowEntry.id === id ? { ...windowEntry, ...patch } : windowEntry,
  );
}
