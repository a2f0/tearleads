import { useCallback, useEffect, useRef, useState } from "react";
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

  // Keep the state updater pure; persist as an effect instead.
  const toggleColumn = useCallback((id: ExplorerItemColumnId) => {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // The detail panel remounts per container, so skip persisting the value just
  // loaded from storage and only write real user changes back.
  const isInitialRenderRef = useRef(true);
  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false;
      return;
    }
    saveHiddenExplorerColumns(hiddenColumns);
  }, [hiddenColumns]);

  return { hiddenColumns, toggleColumn };
}
