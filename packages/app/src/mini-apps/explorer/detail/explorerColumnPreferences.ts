import {
  type ExplorerItemColumnId,
  isToggleableExplorerItemColumnId,
} from "./explorerItemColumnIds";

// Column visibility is a display preference, persisted globally (not per
// container or per identity) — mirrors the system-monitor mode persistence.
const STORAGE_KEY = "tearleads.explorer:hidden-columns";

// Date Created is hidden until the user opts in. A written value (including an
// empty list) always wins, so an explicit "show everything" choice survives.
export const DEFAULT_HIDDEN_EXPLORER_COLUMNS: ReadonlyArray<ExplorerItemColumnId> =
  ["created"];

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function defaultHiddenColumns(): Set<ExplorerItemColumnId> {
  return new Set(DEFAULT_HIDDEN_EXPLORER_COLUMNS);
}

export function loadHiddenExplorerColumns(): ReadonlySet<ExplorerItemColumnId> {
  const storage = getStorage();
  if (!storage) {
    return defaultHiddenColumns();
  }
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (stored === null) {
      return defaultHiddenColumns();
    }
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return defaultHiddenColumns();
    }
    return new Set(parsed.filter(isToggleableExplorerItemColumnId));
  } catch {
    return defaultHiddenColumns();
  }
}

export function saveHiddenExplorerColumns(
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...hiddenColumns]));
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}
