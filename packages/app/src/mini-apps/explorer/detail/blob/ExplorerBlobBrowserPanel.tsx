import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerDocumentObjectSyncState,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import { MiniAppPanel } from "../../../../components/shared/MiniAppLayout";
import type { BlobPickTarget } from "../../../shared/blob-pick/BlobPickProvider";
import {
  BlobListScreen,
  BlobPickSurface,
} from "../../../shared/blob-pick/blob-list/BlobListScreen";
import {
  type BlobBrowserRoute,
  getContainerNameById,
  useBlobBrowserData,
} from "../../../shared/blob-pick/blob-list/blobListState";
import { ExplorerSyncStateBadge } from "../../ExplorerSyncStateBadge";
import {
  BlobBrowserHeader,
  BlobBrowserRowContextMenu,
  BlobDetail,
} from "./ExplorerBlobBrowserSections";
import { useBlobBrowserContextMenu } from "./useBlobBrowserContextMenu";

type BlobBrowserData = ReturnType<typeof useBlobBrowserData>;

// The Explorer shows a per-blob sync badge in the list's sync column; the shared
// table computes the sync state and defers this host-specific rendering.
function renderExplorerSyncCell(
  syncState: ContainerDocumentObjectSyncState,
  isOnline: boolean,
) {
  return (
    <ExplorerSyncStateBadge
      online={isOnline}
      showSynced
      syncState={syncState}
    />
  );
}

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
  pickTarget?: BlobPickTarget | null | undefined;
  onCancelBlobPick?: (() => void) | undefined;
  onPickBlob?: ((blob: BlobInfo) => void) | undefined;
  route: BlobBrowserRoute;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
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
            downloadMessage={downloadMessage}
            onDownload={downloadBlob}
            openDocumentInfoRoute={params.openDocumentInfoRoute}
            selectDocumentProjection={params.selectDocumentProjection}
          />
        </div>
      ) : (
        <BlobListScreen
          blobInfo={data.blobInfo}
          blobStore={params.blobStore}
          downloadMessage={downloadMessage}
          frameRef={data.frameRef}
          isWindowPending={data.isWindowPending}
          onQueryChange={data.handleQueryChange}
          onRowContextMenu={openContextMenu}
          onSelectBlob={data.handleSelectBlob}
          onSort={data.handleSort}
          online={params.online}
          query={data.query}
          renderSyncCell={renderExplorerSyncCell}
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
  const pickBlob = params.onPickBlob;
  const onCancel = useCallback(
    () => (params.onCancelBlobPick ?? params.onBackToSelectionRoute)(),
    [params.onCancelBlobPick, params.onBackToSelectionRoute],
  );

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--blob-browser"
      key={`${params.route.blobId ?? ""}:${params.route.storageKey ?? ""}`}
    >
      {params.pickTarget && pickBlob ? (
        <BlobPickSurface
          blobStore={params.blobStore}
          loadBlobInfo={params.loadBlobInfo}
          onCancel={onCancel}
          online={params.online}
          onPickBlob={pickBlob}
          renderSyncCell={renderExplorerSyncCell}
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
