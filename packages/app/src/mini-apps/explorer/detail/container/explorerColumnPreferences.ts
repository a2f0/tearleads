import {
  loadMiniAppHiddenColumns,
  saveMiniAppHiddenColumns,
} from "../../../../components/mini-app/MiniAppTable";
import {
  type ExplorerItemColumnId,
  TOGGLEABLE_COLUMN_IDS,
} from "./explorerItemColumnIds";

// Column visibility is a display preference, persisted globally (not per
// container or per identity) — mirrors the system-monitor mode persistence.
export const EXPLORER_COLUMN_STORAGE_KEY = "symcrypt.explorer:hidden-columns";

// Date Created and Sync are hidden until the user opts in. A written value
// (including an empty list) always wins, so an explicit "show everything"
// choice survives.
export const DEFAULT_HIDDEN_EXPLORER_COLUMNS: ReadonlyArray<ExplorerItemColumnId> =
  ["created", "sync"];

export function loadHiddenExplorerColumns(): ReadonlySet<ExplorerItemColumnId> {
  return loadMiniAppHiddenColumns({
    defaultHiddenColumnIds: DEFAULT_HIDDEN_EXPLORER_COLUMNS,
    storageKey: EXPLORER_COLUMN_STORAGE_KEY,
    toggleableColumnIds: TOGGLEABLE_COLUMN_IDS,
  });
}

export function saveHiddenExplorerColumns(
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>,
): void {
  saveMiniAppHiddenColumns({
    hiddenColumns,
    storageKey: EXPLORER_COLUMN_STORAGE_KEY,
  });
}
