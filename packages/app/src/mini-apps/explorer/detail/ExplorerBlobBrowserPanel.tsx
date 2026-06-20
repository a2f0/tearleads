import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortKey,
  BlobStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppPanel,
  MiniAppToolbar,
} from "../../../components/shared/MiniAppLayout";
import { useMiniAppVirtualWindow } from "../../../components/shared/MiniAppVirtual";
import { EXPLORER_LABELS } from "../labels";
import { compactId } from "./compactId";
import { BlobDetail, BlobInfoTable } from "./ExplorerBlobBrowserSections";
import {
  BLOB_BROWSER_ROW_HEIGHT,
  type BlobBrowserRoute,
  getBlobRouteQuery,
  getContainerNameById,
  getNextBlobInfoSort,
  getSelectedBlob,
  useBlobInfoList,
} from "./ExplorerBlobBrowserState";

// NUL separator: a query can never contain it, so the query and sort fields
// can never collide when building the virtual-window reset key.
const BLOB_BROWSER_RESET_KEY_SEPARATOR = "\u0000";

export function ExplorerBlobBrowserPanel(params: {
  blobStore: BlobStore;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  route: BlobBrowserRoute;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
}) {
  const [query, setQuery] = useState(() => getBlobRouteQuery(params.route));
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [activeBlob, setActiveBlob] = useState<BlobInfo | null>(null);
  const [sort, setSort] = useState<BlobInfoSort>({
    direction: "desc",
    key: "updated",
  });
  const routeQuery = getBlobRouteQuery(params.route);
  const resetKey = [debouncedQuery, sort.key, sort.direction].join(
    BLOB_BROWSER_RESET_KEY_SEPARATOR,
  );
  const { frameRef, limit, offset } = useMiniAppVirtualWindow({
    resetKey,
    rowHeight: BLOB_BROWSER_ROW_HEIGHT,
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
    activeBlob,
    route: params.route,
    rows,
  });
  const containerNamesById = useMemo(
    () => getContainerNameById(params.nodes),
    [params.nodes],
  );
  const handleSort = useCallback((key: BlobInfoSortKey) => {
    setActiveBlob(null);
    setSort((currentSort) => getNextBlobInfoSort(currentSort, key));
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);

    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    setActiveBlob(null);
    setQuery(routeQuery);
    setDebouncedQuery(routeQuery);
  }, [routeQuery]);

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--blob-browser"
      key={`${params.route.blobId ?? ""}:${params.route.storageKey ?? ""}`}
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.blobBrowserTitle}</strong>
          <span>
            {selectedBlob
              ? compactId(selectedBlob.blobId ?? selectedBlob.storageKey)
              : EXPLORER_LABELS.blobBrowserNoSelection}
          </span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton onClick={params.onBackToSelectionRoute}>
            {EXPLORER_LABELS.blobBrowserBackAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppToolbar>
        <MiniAppInput
          aria-label={EXPLORER_LABELS.blobBrowserSearchPlaceholder}
          onChange={(event) => {
            setActiveBlob(null);
            setQuery(event.currentTarget.value);
          }}
          placeholder={EXPLORER_LABELS.blobBrowserSearchPlaceholder}
          value={query}
        />
      </MiniAppToolbar>
      <div className="explorer-blob-browser-grid">
        <BlobInfoTable
          activeBlob={selectedBlob}
          error={blobInfo.error}
          frameRef={frameRef}
          isLoading={blobInfo.isLoading || isWindowPending}
          onSelectBlob={setActiveBlob}
          onSort={handleSort}
          rowOffset={rowOffset}
          rows={rows}
          sort={sort}
          totalCount={blobInfo.totalCount}
        />
        <BlobDetail
          blob={selectedBlob}
          blobStore={params.blobStore}
          containerNamesById={containerNamesById}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          selectDocumentProjection={params.selectDocumentProjection}
        />
      </div>
    </MiniAppPanel>
  );
}
