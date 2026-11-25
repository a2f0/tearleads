import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  getMiniAppItemGridColumns,
  getMiniAppItemGridItemWindow,
} from "../../../../components/mini-app/item-view/MiniAppItemGrid";
import { useMiniAppItemView } from "../../../../components/mini-app/item-view/miniAppItemView";
import { useMiniAppItemViewLayout } from "../../../../components/mini-app/item-view/useMiniAppItemViewLayout";
import { shouldFoldCompactRows } from "../../../../components/mini-app/MiniAppTable";
import { useMiniAppVirtualWindow } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import {
  type BlobSelectionState,
  FOLLOWING_ROUTE,
  transitionBlobSelection,
} from "./blobSelectionMachine";

// The subset of a host route the blob list reads: the deep-link target (blob id
// or storage key) that seeds the initial search/selection. Standalone so the
// shared surface stays decoupled from any mini-app's route union; hosts pass a
// structurally-compatible object (e.g. the Explorer's blob-browser route, or an
// empty target in pick mode).
export interface BlobBrowserRoute {
  blobId: string | null;
  storageKey: string | null;
}

export interface BlobInfoListState {
  error: string | null;
  isLoading: boolean;
  offset: number;
  rows: ReadonlyArray<BlobInfo>;
  totalCount: number;
}

// NUL separator: a query can never contain it, so the query and sort fields
// can never collide when building the virtual-window reset key.
const BLOB_BROWSER_RESET_KEY_SEPARATOR = "\u0000";

function getBlobRouteQuery(route: BlobBrowserRoute): string {
  return route.blobId ?? route.storageKey ?? "";
}

export function getBlobDisplayName(
  blob: Pick<BlobInfo, "name" | "blobId" | "storageKey">,
): string {
  return blob.name?.trim() || blob.blobId || blob.storageKey;
}

export function getBlobChangedAt(blob: BlobInfo): string | null {
  return blob.updatedAt ?? blob.createdAt;
}

// The list's view is a display preference of the blob list itself, kept apart
// from the Explorer item list's: the two surfaces are browsed differently.
const BLOB_LIST_ITEM_VIEW_STORAGE_KEY = "tearleads.blob-browser:item-view";

export function getNextBlobInfoSort(
  currentSort: BlobInfoSort,
  key: BlobInfoSortKey,
): BlobInfoSort {
  if (currentSort.key === key) {
    return {
      direction: currentSort.direction === "asc" ? "desc" : "asc",
      key,
    };
  }

  return {
    direction: key === "mimeType" ? "asc" : "desc",
    key,
  };
}

export function getContainerNameById(
  nodes: ReadonlyArray<ContainerNode>,
): ReadonlyMap<string, string> {
  return new Map(nodes.map((node) => [node.id, node.name]));
}

function useBlobInfoList(params: {
  limit: number;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  offset: number;
  query: string;
  sort: BlobInfoSort;
}) {
  const { limit, loadBlobInfo, offset, query, sort } = params;
  const [state, setState] = useState<BlobInfoListState>({
    error: null,
    isLoading: false,
    offset: 0,
    rows: [],
    totalCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, error: null, isLoading: true }));

    void loadBlobInfo({
      limit,
      offset,
      query,
      sort,
    })
      .then((result) => {
        if (!cancelled) {
          setState({
            error: null,
            isLoading: false,
            offset,
            rows: result.rows,
            totalCount: result.totalCount,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: unknownErrorMessage(error),
            isLoading: false,
            offset,
            rows: [],
            totalCount: 0,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [limit, loadBlobInfo, offset, query, sort]);

  return state;
}

function matchesRouteTarget(blob: BlobInfo, route: BlobBrowserRoute): boolean {
  if (route.blobId && blob.blobId === route.blobId) {
    return true;
  }

  if (!route.storageKey) {
    return false;
  }

  return (
    blob.storageKey === route.storageKey ||
    blob.references.some(
      (reference) => reference.storageKey === route.storageKey,
    )
  );
}

function getSelectedBlob(params: {
  route: BlobBrowserRoute;
  rows: ReadonlyArray<BlobInfo>;
  selection: BlobSelectionState;
}): BlobInfo | null {
  const { selection } = params;
  switch (selection.status) {
    case "dismissed":
      return null;
    case "selected":
      return (
        params.rows.find((blob) => blob.key === selection.blob.key) ??
        selection.blob
      );
    case "following-route":
      // The list is the default screen; only open the detail screen when the
      // route deep-links to a specific blob. Do not fall back to the first row,
      // which would skip the list entirely.
      return (
        params.rows.find((blob) => matchesRouteTarget(blob, params.route)) ??
        null
      );
  }
}

// The list's view, the pitch that view draws at, and the window of blobs the
// scroll frame asks for at that pitch.
function useBlobListWindow(params: { query: string; sort: BlobInfoSort }) {
  const { sort } = params;
  const itemView = useMiniAppItemView(BLOB_LIST_ITEM_VIEW_STORAGE_KEY);
  const { view } = itemView;
  // Between the two row views the window keeps the top row in place (the
  // pitch change rescales the offset). The grid counts lines of several blobs
  // each, so a switch to or from it starts again at the top.
  const resetKey = [
    params.query,
    sort.key,
    sort.direction,
    view === "grid" ? "grid" : "rows",
  ].join(BLOB_BROWSER_RESET_KEY_SEPARATOR);
  // The frame width arrives a render late (it is measured after mount), so the
  // first paint is single-line and the fold follows. That ordering is
  // deliberate: the pitch feeds the window math, so guessing narrow before
  // measuring would fetch against a pitch the DOM does not have.
  const [narrowFrame, setNarrowFrame] = useState(false);
  const { compact, rowHeight } = useMiniAppItemViewLayout(narrowFrame, view);
  const lineWindow = useMiniAppVirtualWindow({ resetKey, rowHeight });
  const { frameRef, frameWidth } = lineWindow;
  // A table line holds one blob; a grid line holds as many tiles as the
  // measured frame fits, and the window fetches whole lines of them.
  const columns = view === "grid" ? getMiniAppItemGridColumns(frameWidth) : 1;
  const { limit, offset } = getMiniAppItemGridItemWindow({
    columns,
    limit: lineWindow.limit,
    offset: lineWindow.offset,
  });

  useEffect(() => {
    setNarrowFrame((current) => shouldFoldCompactRows(frameWidth, current));
  }, [frameWidth]);

  return { columns, compact, frameRef, itemView, limit, offset, rowHeight };
}

export function useBlobBrowserData(params: {
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  route: BlobBrowserRoute;
}) {
  const [query, setQuery] = useState(() => getBlobRouteQuery(params.route));
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [selection, dispatchSelection] = useReducer(
    transitionBlobSelection,
    FOLLOWING_ROUTE,
  );
  const [sort, setSort] = useState<BlobInfoSort>({
    direction: "desc",
    key: "updated",
  });
  const routeQuery = getBlobRouteQuery(params.route);
  const { limit, offset, ...list } = useBlobListWindow({
    query: debouncedQuery,
    sort,
  });
  const blobInfo = useBlobInfoList({
    limit,
    loadBlobInfo: params.loadBlobInfo,
    offset,
    query: debouncedQuery,
    sort,
  });
  const isWindowPending = blobInfo.offset !== offset;
  const isResettingWindow = isWindowPending && offset === 0;
  const rows = isResettingWindow ? [] : blobInfo.rows;
  const rowOffset = isResettingWindow ? 0 : blobInfo.offset;
  const selectedBlob = getSelectedBlob({
    route: params.route,
    rows,
    selection,
  });
  // A blob opened from the list (not a route deep link) owns a local back
  // action that returns to the list.
  const isListDetail = selection.status === "selected";
  const handleSort = useCallback((key: BlobInfoSortKey) => {
    dispatchSelection({ type: "sorted" });
    setSort((currentSort) => getNextBlobInfoSort(currentSort, key));
  }, []);
  const handleSelectBlob = useCallback((blob: BlobInfo) => {
    dispatchSelection({ blob, type: "blob-selected" });
  }, []);
  const handleBackToList = useCallback(() => {
    dispatchSelection({ type: "back-to-list" });
  }, []);
  const handleQueryChange = useCallback((value: string) => {
    dispatchSelection({ type: "query-changed" });
    setQuery(value);
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);

    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    dispatchSelection({ type: "route-changed" });
    setQuery(routeQuery);
    setDebouncedQuery(routeQuery);
  }, [routeQuery]);

  return {
    ...list,
    blobInfo,
    handleBackToList,
    handleQueryChange,
    handleSelectBlob,
    handleSort,
    isListDetail,
    isWindowPending,
    query,
    rowOffset,
    rows,
    selectedBlob,
    sort,
  };
}
