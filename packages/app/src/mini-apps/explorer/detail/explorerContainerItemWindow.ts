import type {
  ContainerDocumentQueries,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import { MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT } from "../../../components/shared/MiniAppVirtual";

export const EXPLORER_VIRTUAL_ROW_HEIGHT =
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT;

export function getNextExplorerItemSort(
  currentSort: ContainerItemSort,
  key: ContainerItemSortKey,
): ContainerItemSort {
  if (currentSort.key === key) {
    return {
      direction: currentSort.direction === "asc" ? "desc" : "asc",
      key,
    };
  }

  return {
    direction: key === "name" || key === "type" ? "asc" : "desc",
    key,
  };
}

interface ContainerItemWindowState {
  error: string | null;
  isLoading: boolean;
  offset: number;
  rows: ReadonlyArray<ContainerItemRow>;
  totalCount: number;
}

const EMPTY_CONTAINER_ITEM_WINDOW_STATE: ContainerItemWindowState = {
  error: null,
  isLoading: false,
  offset: 0,
  rows: [],
  totalCount: 0,
};

interface ExplorerContainerItemWindowParams {
  // The current container nodes; its reference changes whenever the container
  // tree is rebuilt, which is used purely as a refetch signal (not read).
  containerNodes: ReadonlyArray<ContainerNode>;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  enabled: boolean;
  limit: number;
  offset: number;
  selectedNode: ContainerNode;
  sort: ContainerItemSort;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}

export function useExplorerContainerItemWindow(
  params: ExplorerContainerItemWindowParams,
) {
  const {
    containerNodes,
    documentListRevision,
    documentQueries,
    enabled,
    limit,
    offset,
    selectedNode,
    sort,
    visibleSystemSlots,
  } = params;
  const [state, setState] = useState<ContainerItemWindowState>(() => ({
    ...EMPTY_CONTAINER_ITEM_WINDOW_STATE,
    // Start loading when a fetch is pending so the first render (before the load
    // effect runs) shows "Loading..." instead of flashing the empty message.
    isLoading: enabled,
  }));
  const serializedSystemSlots = useMemo(
    () => Array.from(visibleSystemSlots).sort().join("\u0000"),
    [visibleSystemSlots],
  );
  // Depend on the sort primitives, not the object reference, so a re-created
  // `sort` with the same key/direction doesn't re-run the fetch.
  const { direction: sortDirection, key: sortKey } = sort;

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_CONTAINER_ITEM_WINDOW_STATE);
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      error: null,
      isLoading: true,
    }));

    void documentQueries
      .listContainerItemWindow({
        containerId: selectedNode.id,
        limit,
        offset,
        sort: { direction: sortDirection, key: sortKey },
        visibleSystemSlots: Array.from(visibleSystemSlots),
      })
      .then((window) => {
        if (cancelled) {
          return;
        }

        setState({
          error: null,
          isLoading: false,
          offset,
          rows: window.rows,
          totalCount: window.totalCount,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    containerNodes,
    documentListRevision,
    documentQueries,
    enabled,
    limit,
    offset,
    selectedNode.id,
    sortDirection,
    sortKey,
    serializedSystemSlots,
  ]);

  return state;
}
