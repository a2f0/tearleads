import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../../utils/storedPreference";

export interface MiniAppColumnVisibility<ColumnId extends string> {
  hiddenColumns: ReadonlySet<ColumnId>;
  toggleColumn: (id: ColumnId) => void;
}

interface MiniAppColumnVisibilityStorageOptions<ColumnId extends string> {
  defaultHiddenColumnIds?: ReadonlyArray<ColumnId> | undefined;
  storageKey: string;
  toggleableColumnIds: ReadonlyArray<ColumnId>;
}

function filterKnownColumnIds<ColumnId extends string>(
  values: ReadonlyArray<unknown>,
  toggleableColumnIds: ReadonlyArray<ColumnId>,
): Set<ColumnId> {
  return new Set(
    values.filter(
      (value): value is ColumnId =>
        typeof value === "string" &&
        toggleableColumnIds.some((columnId) => columnId === value),
    ),
  );
}

function defaultHiddenColumns<ColumnId extends string>(
  options: MiniAppColumnVisibilityStorageOptions<ColumnId>,
): Set<ColumnId> {
  return filterKnownColumnIds(
    options.defaultHiddenColumnIds ?? [],
    options.toggleableColumnIds,
  );
}

export function loadMiniAppHiddenColumns<ColumnId extends string>(
  options: MiniAppColumnVisibilityStorageOptions<ColumnId>,
): ReadonlySet<ColumnId> {
  return loadStoredPreference(options.storageKey, (stored) => {
    if (stored === null) {
      return defaultHiddenColumns(options);
    }
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return defaultHiddenColumns(options);
    }
    return filterKnownColumnIds(parsed, options.toggleableColumnIds);
  });
}

export function saveMiniAppHiddenColumns<ColumnId extends string>({
  hiddenColumns,
  storageKey,
}: {
  hiddenColumns: ReadonlySet<ColumnId>;
  storageKey: string;
}): void {
  saveStoredPreference(storageKey, JSON.stringify([...hiddenColumns]));
}

export function useMiniAppColumnVisibility<ColumnId extends string>(
  options: MiniAppColumnVisibilityStorageOptions<ColumnId>,
): MiniAppColumnVisibility<ColumnId> {
  const { defaultHiddenColumnIds, storageKey, toggleableColumnIds } = options;
  const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<ColumnId>>(
    () =>
      loadMiniAppHiddenColumns({
        defaultHiddenColumnIds,
        storageKey,
        toggleableColumnIds,
      }),
  );
  const toggleableColumnIdSet = useMemo(
    () => new Set(toggleableColumnIds),
    [toggleableColumnIds],
  );

  useEffect(() => {
    if (loadedStorageKey === storageKey) {
      return;
    }

    setHiddenColumns(
      loadMiniAppHiddenColumns({
        defaultHiddenColumnIds,
        storageKey,
        toggleableColumnIds,
      }),
    );
    setLoadedStorageKey(storageKey);
  }, [
    defaultHiddenColumnIds,
    loadedStorageKey,
    storageKey,
    toggleableColumnIds,
  ]);

  const toggleColumn = useCallback(
    (id: ColumnId) => {
      setHiddenColumns((current) => {
        if (!toggleableColumnIdSet.has(id)) {
          return current;
        }
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [toggleableColumnIdSet],
  );

  const isInitialRenderRef = useRef(true);
  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false;
      return;
    }
    if (loadedStorageKey !== storageKey) {
      return;
    }
    saveMiniAppHiddenColumns({
      hiddenColumns,
      storageKey,
    });
  }, [hiddenColumns, loadedStorageKey, storageKey]);

  return { hiddenColumns, toggleColumn };
}

export function getVisibleMiniAppTableColumnIds<ColumnId extends string>(
  columnIds: ReadonlyArray<ColumnId>,
  hiddenColumns: ReadonlySet<ColumnId>,
): ReadonlyArray<ColumnId> {
  return columnIds.filter((columnId) => !hiddenColumns.has(columnId));
}
