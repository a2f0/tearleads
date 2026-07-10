import {
  type MiniAppColumnVisibility,
  useMiniAppColumnVisibility,
} from "../../../../components/shared/MiniAppTable";
import {
  DEFAULT_HIDDEN_EXPLORER_COLUMNS,
  EXPLORER_COLUMN_STORAGE_KEY,
} from "./explorerColumnPreferences";
import {
  type ExplorerItemColumnId,
  TOGGLEABLE_COLUMN_IDS,
} from "./explorerItemColumnIds";

type ExplorerColumnVisibility = MiniAppColumnVisibility<ExplorerItemColumnId>;

export function useExplorerColumnVisibility(): ExplorerColumnVisibility {
  return useMiniAppColumnVisibility({
    defaultHiddenColumnIds: DEFAULT_HIDDEN_EXPLORER_COLUMNS,
    storageKey: EXPLORER_COLUMN_STORAGE_KEY,
    toggleableColumnIds: TOGGLEABLE_COLUMN_IDS,
  });
}
