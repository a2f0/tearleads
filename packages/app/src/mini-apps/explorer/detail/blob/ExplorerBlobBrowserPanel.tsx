import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { MiniAppPanel } from "../../../../components/shared/MiniAppLayout";
import { isImageDocumentAttachmentBlob } from "../../../../document-types/shared/documentAttachmentUtils";
import type { ExplorerBlobPickTarget } from "../../blob-pick/ExplorerBlobPickProvider";
import {
  BlobBrowserHeader,
  BlobBrowserListScreen,
  BlobBrowserRowContextMenu,
  BlobDetail,
  BlobPickHeader,
} from "./ExplorerBlobBrowserSections";
import {
  type BlobBrowserRoute,
  getContainerNameById,
  useBlobBrowserData,
} from "./ExplorerBlobBrowserState";
import { useBlobBrowserContextMenu } from "./useBlobBrowserContextMenu";

type BlobBrowserData = ReturnType<typeof useBlobBrowserData>;

interface ExplorerBlobBrowserPanelProps {
  blobStore: BlobStore;
  domainScope: DomainScope;
  // When embedded in the compact tabbed hub the tab bar owns top-level
  // navigation, so the list-mode "Back to Explorer" header button is hidden
  // (the blob-detail "Back to List" stays — it navigates within this panel).
  embedded?: boolean;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  online: boolean;
  // When set, the panel runs in pick mode: rows resolve the pick (instead of
  // opening blob detail) and the list is filtered to image blobs.
  pickTarget?: ExplorerBlobPickTarget | null | undefined;
  onCancelBlobPick?: (() => void) | undefined;
  onPickBlob?: ((blob: BlobInfo) => void) | undefined;
  route: BlobBrowserRoute;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}

// Pick mode: choose an image blob for a document slot. Only image blobs bind to
// image slots, so non-image rows are shown but not selectable, and a row click
// resolves the pick rather than opening blob detail.
function BlobBrowserPickScreen(params: {
  data: BlobBrowserData;
  onCancel: () => void;
  online: boolean;
  onPickBlob: ((blob: BlobInfo) => void) | undefined;
  slotLabel: string;
}) {
  const { data } = params;

  return (
    <>
      <BlobPickHeader onCancel={params.onCancel} slotLabel={params.slotLabel} />
      <BlobBrowserListScreen
        blobInfo={data.blobInfo}
        frameRef={data.frameRef}
        // Filtering non-image rows out of the windowed list would desync the
        // virtual-scroll padding from the total count, so disable instead.
        isRowSelectable={isImageDocumentAttachmentBlob}
        isWindowPending={data.isWindowPending}
        onQueryChange={data.handleQueryChange}
        onSelectBlob={params.onPickBlob ?? data.handleSelectBlob}
        onSort={data.handleSort}
        online={params.online}
        query={data.query}
        rowOffset={data.rowOffset}
        rows={data.rows}
        sort={data.sort}
      />
    </>
  );
}

// Browse mode: view blob metadata/preview, and right-click (or long-press) a row
// to download the blob's local bytes.
function BlobBrowserBrowseScreen(params: {
  blobStore: BlobStore;
  containerNamesById: ReadonlyMap<string, string>;
  data: BlobBrowserData;
  embedded: boolean;
  onBackToSelectionRoute: () => void;
  online: boolean;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}) {
  const { data } = params;
  const {
    closeContextMenu,
    contextMenu,
    downloadBlob,
    downloadMessage,
    openContextMenu,
  } = useBlobBrowserContextMenu({
    blobStore: params.blobStore,
    query: data.query,
    selectedBlob: data.selectedBlob,
  });
  const isDetailScreen = data.selectedBlob !== null;

  return (
    <>
      <BlobBrowserHeader
        embedded={params.embedded}
        onBack={
          isDetailScreen ? data.handleBackToList : params.onBackToSelectionRoute
        }
        selectedBlob={data.selectedBlob}
      />
      {isDetailScreen ? (
        <div className="explorer-blob-browser-screen">
          <BlobDetail
            blob={data.selectedBlob}
            blobStore={params.blobStore}
            containerNamesById={params.containerNamesById}
            openDocumentInfoRoute={params.openDocumentInfoRoute}
            selectDocumentProjection={params.selectDocumentProjection}
          />
        </div>
      ) : (
        <BlobBrowserListScreen
          blobInfo={data.blobInfo}
          downloadMessage={downloadMessage}
          frameRef={data.frameRef}
          isWindowPending={data.isWindowPending}
          onQueryChange={data.handleQueryChange}
          onRowContextMenu={openContextMenu}
          onSelectBlob={data.handleSelectBlob}
          onSort={data.handleSort}
          online={params.online}
          query={data.query}
          rowOffset={data.rowOffset}
          rows={data.rows}
          sort={data.sort}
        />
      )}
      {contextMenu ? (
        <BlobBrowserRowContextMenu
          blob={contextMenu.id}
          onClose={closeContextMenu}
          onDownload={downloadBlob}
          position={contextMenu.position}
        />
      ) : null}
    </>
  );
}

export function ExplorerBlobBrowserPanel(
  params: ExplorerBlobBrowserPanelProps,
) {
  const data = useBlobBrowserData({
    loadBlobInfo: params.loadBlobInfo,
    route: params.route,
  });
  const containerNamesById = useMemo(
    () => getContainerNameById(params.nodes),
    [params.nodes],
  );

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--blob-browser"
      key={`${params.route.blobId ?? ""}:${params.route.storageKey ?? ""}`}
    >
      {params.pickTarget ? (
        <BlobBrowserPickScreen
          data={data}
          onCancel={params.onCancelBlobPick ?? params.onBackToSelectionRoute}
          online={params.online}
          onPickBlob={params.onPickBlob}
          slotLabel={params.pickTarget.slotLabel}
        />
      ) : (
        <BlobBrowserBrowseScreen
          blobStore={params.blobStore}
          containerNamesById={containerNamesById}
          data={data}
          embedded={params.embedded ?? false}
          onBackToSelectionRoute={params.onBackToSelectionRoute}
          online={params.online}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          selectDocumentProjection={params.selectDocumentProjection}
        />
      )}
    </MiniAppPanel>
  );
}
