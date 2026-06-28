import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { MiniAppPanel } from "../../../components/shared/MiniAppLayout";
import { isImageDocumentAttachmentBlob } from "../../../document-types/shared/documentAttachmentUtils";
import type { ExplorerBlobPickTarget } from "../blob-pick/ExplorerBlobPickProvider";
import {
  BlobBrowserHeader,
  BlobBrowserListScreen,
  BlobDetail,
  BlobPickHeader,
} from "./ExplorerBlobBrowserSections";
import {
  type BlobBrowserRoute,
  getContainerNameById,
  useBlobBrowserData,
} from "./ExplorerBlobBrowserState";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";

interface ExplorerBlobBrowserPanelProps {
  blobStore: BlobStore;
  domainScope: DomainScope;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  // When set, the panel runs in pick mode: rows resolve the pick (instead of
  // opening blob detail) and the list is filtered to image blobs.
  pickTarget?: ExplorerBlobPickTarget | null | undefined;
  onCancelBlobPick?: (() => void) | undefined;
  onPickBlob?: ((blob: BlobInfo) => void) | undefined;
  route: BlobBrowserRoute;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
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
  const syncSnapshot = useDomainSyncSnapshot(params.domainScope);
  const containerNamesById = useMemo(
    () => getContainerNameById(params.nodes),
    [params.nodes],
  );
  const isPicking = Boolean(params.pickTarget);
  // In pick mode the detail screen is never shown — a row click resolves the
  // pick straight away — so honour the route-driven detail screen only when
  // browsing normally.
  const isDetailScreen = !isPicking && selectedBlob !== null;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--blob-browser"
      key={`${params.route.blobId ?? ""}:${params.route.storageKey ?? ""}`}
      variant="framed"
    >
      {isPicking && params.pickTarget ? (
        <BlobPickHeader
          onCancel={params.onCancelBlobPick ?? params.onBackToSelectionRoute}
          slotLabel={params.pickTarget.slotLabel}
        />
      ) : (
        <BlobBrowserHeader
          onBack={
            isDetailScreen ? handleBackToList : params.onBackToSelectionRoute
          }
          selectedBlob={selectedBlob}
        />
      )}
      {isDetailScreen ? (
        <div className="explorer-blob-browser-screen">
          <BlobDetail
            blob={selectedBlob}
            blobStore={params.blobStore}
            containerNamesById={containerNamesById}
            openDocumentInfoRoute={params.openDocumentInfoRoute}
            selectDocumentProjection={params.selectDocumentProjection}
            syncSnapshot={syncSnapshot}
          />
        </div>
      ) : (
        <BlobBrowserListScreen
          blobInfo={blobInfo}
          frameRef={frameRef}
          // Only image blobs bind to image slots, so in pick mode non-image rows
          // are shown but not pickable. Filtering them out of the windowed list
          // would desync the virtual-scroll padding from the total count.
          isRowSelectable={
            isPicking ? isImageDocumentAttachmentBlob : undefined
          }
          isWindowPending={isWindowPending}
          onQueryChange={handleQueryChange}
          onSelectBlob={
            isPicking && params.onPickBlob
              ? params.onPickBlob
              : handleSelectBlob
          }
          onSort={handleSort}
          query={query}
          rowOffset={rowOffset}
          rows={rows}
          sort={sort}
          syncSnapshot={syncSnapshot}
        />
      )}
    </MiniAppPanel>
  );
}
