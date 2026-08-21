import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortKey,
  ContainerNode,
} from "@symcrypt/client-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  getMiniAppCompactTableRowHeight,
  shouldFoldCompactRows,
  useMiniAppCompactTableLayout,
} from "../../../../components/mini-app/MiniAppTable";
import { useMiniAppVirtualWindow } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { useTouchRowHeight } from "../../../../navigation/useTouchRowHeight";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

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

export function getBlobChangedAt(blob: BlobInfo): string | null {
  return blob.updatedAt ?? blob.createdAt;
}

/**
 * The one row pitch for the blob list, and whether the row folds into a
 * two-line summary.
 *
 * Three places have to agree on the pitch — the virtual window math (which
 * derives the fetched limit/offset), the spacer padding, and the frame's
 * `--mini-app-virtual-row-height` — or the served rows land in a window the
 * table is not showing. That is why this takes `narrowFrame` as an argument
 * rather than measuring: this hook owns the scroll frame, so it measures once
 * and hands the result to the table, which cannot derive a disagreeing answer.
 *
 * `useTouchRowHeight` mirrors the bump `useMiniAppVirtualWindow` already applies
 * internally, so the rendered pitch and the window math also agree on routed
 * tablets (44px), not just on phones (56px) and desktop (36px). It is
 * `Math.max`-based, so it is a no-op at the two-line pitch.
 */
function useBlobListTableLayout(narrowFrame: boolean): {
  compact: boolean;
  rowHeight: number;
} {
  const { compact: tierCompact } = useMiniAppCompactTableLayout();
  const compact = tierCompact || narrowFrame;
  const rowHeight = useTouchRowHeight(getMiniAppCompactTableRowHeight(compact));
  return { compact, rowHeight };
}

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
  activeBlob: BlobInfo | null;
  route: BlobBrowserRoute;
  rows: ReadonlyArray<BlobInfo>;
}): BlobInfo | null {
  if (params.activeBlob) {
    return (
      params.rows.find((blob) => blob.key === params.activeBlob?.key) ??
      params.activeBlob
    );
  }

  // The list is the default screen; only open the detail screen when the route
  // deep-links to a specific blob. Do not fall back to the first row, which
  // would skip the list entirely.
  return (
    params.rows.find((blob) => matchesRouteTarget(blob, params.route)) ?? null
  );
}

export function useBlobBrowserData(params: {
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  route: BlobBrowserRoute;
}) {
  const [query, setQuery] = useState(() => getBlobRouteQuery(params.route));
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [activeBlob, setActiveBlob] = useState<BlobInfo | null>(null);
  // Tracks whether the user dismissed the detail screen. Needed because a
  // route deep-link makes getSelectedBlob return a blob even when activeBlob is
  // null, so clearing activeBlob alone could not return to the list.
  const [isDetailDismissed, setIsDetailDismissed] = useState(false);
  const [sort, setSort] = useState<BlobInfoSort>({
    direction: "desc",
    key: "updated",
  });
  const routeQuery = getBlobRouteQuery(params.route);
  const resetKey = [debouncedQuery, sort.key, sort.direction].join(
    BLOB_BROWSER_RESET_KEY_SEPARATOR,
  );
  // The frame width arrives a render late (it is measured after mount), so the
  // first paint is single-line and the fold follows. That ordering is
  // deliberate: the pitch feeds the window math, so guessing narrow before
  // measuring would fetch against a pitch the DOM does not have.
  const [narrowFrame, setNarrowFrame] = useState(false);
  const { compact, rowHeight } = useBlobListTableLayout(narrowFrame);
  const { frameRef, frameWidth, limit, offset } = useMiniAppVirtualWindow({
    resetKey,
    rowHeight,
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
  const selectedBlob = isDetailDismissed
    ? null
    : getSelectedBlob({ activeBlob, route: params.route, rows });
  const isListDetail = activeBlob !== null && selectedBlob !== null;
  const handleSort = useCallback((key: BlobInfoSortKey) => {
    setActiveBlob(null);
    setSort((currentSort) => getNextBlobInfoSort(currentSort, key));
  }, []);
  const handleSelectBlob = useCallback((blob: BlobInfo) => {
    setActiveBlob(blob);
    setIsDetailDismissed(false);
  }, []);
  const handleBackToList = useCallback(() => {
    setActiveBlob(null);
    setIsDetailDismissed(true);
  }, []);
  const handleQueryChange = useCallback((value: string) => {
    setActiveBlob(null);
    setIsDetailDismissed(true);
    setQuery(value);
  }, []);

  useEffect(() => {
    setNarrowFrame((current) => shouldFoldCompactRows(frameWidth, current));
  }, [frameWidth]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);

    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    setActiveBlob(null);
    setIsDetailDismissed(false);
    setQuery(routeQuery);
    setDebouncedQuery(routeQuery);
  }, [routeQuery]);

  return {
    blobInfo,
    compact,
    frameRef,
    handleBackToList,
    handleQueryChange,
    handleSelectBlob,
    handleSort,
    isListDetail,
    isWindowPending,
    query,
    rowHeight,
    rowOffset,
    rows,
    selectedBlob,
    sort,
  };
}
