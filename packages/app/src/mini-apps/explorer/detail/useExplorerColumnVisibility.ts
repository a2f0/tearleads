import { useCallback, useState } from "react";
import {
  loadHiddenExplorerColumns,
  saveHiddenExplorerColumns,
} from "./explorerColumnPreferences";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";

export interface ExplorerColumnVisibility {
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>;
  toggleColumn: (id: ExplorerItemColumnId) => void;
}

export function useExplorerColumnVisibility(): ExplorerColumnVisibility {
  const [hiddenColumns, setHiddenColumns] = useState<
    ReadonlySet<ExplorerItemColumnId>
  >(loadHiddenExplorerColumns);

  const toggleColumn = useCallback((id: ExplorerItemColumnId) => {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveHiddenExplorerColumns(next);
      return next;
    });
  }, []);

  return { hiddenColumns, toggleColumn };
}
