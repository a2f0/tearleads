import type { WindowEntry } from "../types";

export function updateWindowFlag(
  windows: WindowEntry[],
  id: string,
  patch: Partial<
    Pick<WindowEntry, "maximized" | "minimized" | "position" | "size" | "title">
  >,
) {
  return windows.map((windowEntry) =>
    windowEntry.id === id ? { ...windowEntry, ...patch } : windowEntry,
  );
}
