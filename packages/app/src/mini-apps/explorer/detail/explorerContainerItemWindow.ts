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

export function useExplorerContainerItemWindow(params: {
  containerListRevision: unknown;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  enabled: boolean;
  limit: number;
  offset: number;
  selectedNode: ContainerNode;
  sort: ContainerItemSort;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}) {
  const {
    containerListRevision,
    documentListRevision,
    documentQueries,
    enabled,
    limit,
    offset,
    selectedNode,
    sort,
    visibleSystemSlots,
  } = params;
  const [state, setState] = useState<{
    error: string | null;
    isLoading: boolean;
    offset: number;
    rows: ReadonlyArray<ContainerItemRow>;
    totalCount: number;
  }>({
    error: null,
    // Start loading when a fetch is pending so the first render (before the load
    // effect runs) shows "Loading..." instead of flashing the empty message.
    isLoading: enabled,
    offset: 0,
    rows: [],
    totalCount: 0,
  });
  const serializedSystemSlots = useMemo(
    () => Array.from(visibleSystemSlots).sort().join("\u0000"),
    [visibleSystemSlots],
  );

  useEffect(() => {
    if (!enabled) {
      setState({
        error: null,
        isLoading: false,
        offset: 0,
        rows: [],
        totalCount: 0,
      });
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
        sort,
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
    containerListRevision,
    documentListRevision,
    documentQueries,
    enabled,
    limit,
    offset,
    selectedNode.id,
    sort,
    serializedSystemSlots,
  ]);

  return state;
}
