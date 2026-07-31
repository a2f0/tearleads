import type {
  ContainerDocumentQueries,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import {
  getMiniAppCompactTableRowHeight,
  useMiniAppCompactTableLayout,
} from "../../../../components/mini-app/MiniAppTable";
import { useTouchRowHeight } from "../../../../navigation/useTouchRowHeight";
import { explorerDocumentQueryContainerId } from "../../../../stores/explorer/orphanedDocuments";
import { SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES } from "../../../../stores/systemContainers";

/**
 * The one row pitch for the explorer item list, and whether the row folds into
 * a two-line summary.
 *
 * Three places have to agree on the pitch — the virtual window math (which
 * derives the fetched limit/offset in ExplorerContainerDetail), the spacer
 * padding, and the frame's `--mini-app-virtual-row-height` — or the requested
 * and served offsets diverge and the detail pane blanks the table (see
 * `isShowingRequestedWindow`). That is why this takes `narrowFrame` as an
 * argument rather than measuring: only the detail pane owns the scroll frame,
 * so it measures once and hands the result down, and the item table cannot
 * derive a second, disagreeing answer.
 *
 * `useTouchRowHeight` mirrors the bump `useMiniAppVirtualWindow` already
 * applies internally, so the rendered pitch and the window math also agree on
 * routed tablets (44px), not just on phones (56px) and desktop (36px). It is
 * `Math.max`-based, so it is a no-op at the two-line pitch.
 */
export function useExplorerItemTableLayout(narrowFrame: boolean): {
  compact: boolean;
  rowHeight: number;
} {
  const { compact: tierCompact } = useMiniAppCompactTableLayout();
  const compact = tierCompact || narrowFrame;
  const rowHeight = useTouchRowHeight(getMiniAppCompactTableRowHeight(compact));
  return { compact, rowHeight };
}

const EXPLORER_SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES = Array.from(
  SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES,
);

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
  // The container the current rows/totalCount were fetched for (also set on a
  // failed fetch, so the error renders instead of a stuck loading row). While it
  // differs from the selected container the state is treated as not-yet-loaded.
  loadedContainerId: string | null;
  offset: number;
  rows: ReadonlyArray<ContainerItemRow>;
  totalCount: number;
}

const EMPTY_CONTAINER_ITEM_WINDOW_STATE: ContainerItemWindowState = {
  error: null,
  isLoading: false,
  loadedContainerId: null,
  offset: 0,
  rows: [],
  totalCount: 0,
};

// Refetches for a container that already resolved (sync convergence, list
// revision bumps, viewport-driven limit changes) must not flash the loading
// row over settled content — an empty container would otherwise flicker
// between "No items." and "Loading..." on every convergence event. Loading is
// only surfaced before the container's first result, or when the requested
// scroll window's rows are genuinely absent (totalCount > 0, rows off-window).
function getContainerItemWindowView(
  state: ContainerItemWindowState,
  enabled: boolean,
  selectedContainerId: string,
) {
  const hasLoadedSelectedContainer =
    enabled && state.loadedContainerId === selectedContainerId;

  return {
    error: state.error,
    isLoading: enabled
      ? !hasLoadedSelectedContainer || (state.isLoading && state.totalCount > 0)
      : false,
    offset: state.offset,
    rows: hasLoadedSelectedContainer
      ? state.rows
      : EMPTY_CONTAINER_ITEM_WINDOW_STATE.rows,
    totalCount: hasLoadedSelectedContainer ? state.totalCount : 0,
  };
}

// A refetch for the already-loaded container keeps the settled rows/count on
// screen (stale-while-revalidate); only a container switch resets the window.
function startContainerItemWindowLoad(
  current: ContainerItemWindowState,
  containerId: string,
): ContainerItemWindowState {
  return current.loadedContainerId === containerId
    ? { ...current, error: null, isLoading: true }
    : { ...EMPTY_CONTAINER_ITEM_WINDOW_STATE, isLoading: true };
}

function failContainerItemWindowLoad(
  current: ContainerItemWindowState,
  containerId: string,
  error: unknown,
): ContainerItemWindowState {
  return {
    ...current,
    error: error instanceof Error ? error.message : String(error),
    isLoading: false,
    loadedContainerId: containerId,
  };
}

interface ExplorerContainerItemWindowParams {
  // The current container nodes; its reference changes whenever the container
  // tree is rebuilt, which is used purely as a refetch signal (not read).
  containerNodes: ReadonlyArray<ContainerNode>;
  currentOrganizationId: string | null | undefined;
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
  const [state, setState] = useState<ContainerItemWindowState>(
    EMPTY_CONTAINER_ITEM_WINDOW_STATE,
  );
  const serializedSystemSlots = Array.from(visibleSystemSlots)
    .sort()
    .join("\u0000");
  // Refetch only when the selected container's own child sub-containers change
  // (id/name/sync), not when any container elsewhere in the tree does. Documents
  // are tracked separately via `documentListRevision`.
  const childContainerSignature = useMemo(
    () =>
      containerNodes
        .filter((node) => node.parentId === selectedNode.id)
        .map((node) => `${node.id} ${node.name} ${node.syncState}`)
        .join("|"),
    [containerNodes, selectedNode.id],
  );
  // Depend on the sort primitives, not the object reference, so a re-created
  // `sort` with the same key/direction doesn't re-run the fetch.
  const { direction: sortDirection, key: sortKey } = sort;

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_CONTAINER_ITEM_WINDOW_STATE);
      return;
    }

    const containerId = selectedNode.id;
    let cancelled = false;
    setState((current) => startContainerItemWindowLoad(current, containerId));

    void documentQueries
      .listContainerItemWindow({
        containerId: explorerDocumentQueryContainerId(containerId),
        currentOrganizationId: params.currentOrganizationId,
        limit,
        offset,
        sort: { direction: sortDirection, key: sortKey },
        visibleForeignSystemContainerNames:
          EXPLORER_SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES,
        visibleSystemSlots: Array.from(visibleSystemSlots),
      })
      .then((window) => {
        if (cancelled) {
          return;
        }

        setState({
          error: null,
          isLoading: false,
          loadedContainerId: containerId,
          offset,
          rows: window.rows,
          totalCount: window.totalCount,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState((current) =>
          failContainerItemWindowLoad(current, containerId, error),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    childContainerSignature,
    params.currentOrganizationId,
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

  return getContainerItemWindowView(state, enabled, selectedNode.id);
}
