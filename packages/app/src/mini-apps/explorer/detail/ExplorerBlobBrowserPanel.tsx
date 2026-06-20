import type {
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { MiniAppPanel } from "../../../components/shared/MiniAppLayout";
import {
  BlobBrowserHeader,
  BlobBrowserListScreen,
  BlobDetail,
} from "./ExplorerBlobBrowserSections";
import {
  type BlobBrowserRoute,
  getContainerNameById,
  useBlobBrowserData,
} from "./ExplorerBlobBrowserState";

interface ExplorerBlobBrowserPanelProps {
  blobStore: BlobStore;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  route: BlobBrowserRoute;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
}

export function ExplorerBlobBrowserPanel(
  params: ExplorerBlobBrowserPanelProps,
) {
  const {
    blobInfo,
    frameRef,
    handleBackToList,
    handleQueryChange,
    handleSelectBlob,
    handleSort,
    isWindowPending,
    query,
    rowOffset,
    rows,
    selectedBlob,
    sort,
  } = useBlobBrowserData({
    loadBlobInfo: params.loadBlobInfo,
    route: params.route,
  });
  const containerNamesById = useMemo(
    () => getContainerNameById(params.nodes),
    [params.nodes],
  );
  const isDetailScreen = selectedBlob !== null;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--blob-browser"
      key={`${params.route.blobId ?? ""}:${params.route.storageKey ?? ""}`}
      variant="framed"
    >
      <BlobBrowserHeader
        onBack={
          isDetailScreen ? handleBackToList : params.onBackToSelectionRoute
        }
        selectedBlob={selectedBlob}
      />
      {isDetailScreen ? (
        <div className="explorer-blob-browser-screen">
          <BlobDetail
            blob={selectedBlob}
            blobStore={params.blobStore}
            containerNamesById={containerNamesById}
            openDocumentInfoRoute={params.openDocumentInfoRoute}
            selectDocumentProjection={params.selectDocumentProjection}
          />
        </div>
      ) : (
        <BlobBrowserListScreen
          blobInfo={blobInfo}
          frameRef={frameRef}
          isWindowPending={isWindowPending}
          onQueryChange={handleQueryChange}
          onSelectBlob={handleSelectBlob}
          onSort={handleSort}
          query={query}
          rowOffset={rowOffset}
          rows={rows}
          sort={sort}
        />
      )}
    </MiniAppPanel>
  );
}
