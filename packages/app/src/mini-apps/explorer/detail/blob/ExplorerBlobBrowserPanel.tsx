import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerDocumentObjectSyncState,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { MiniAppPanel } from "../../../../components/mini-app/MiniAppLayout";
import { useMiniAppDetailBackAction } from "../../../../components/window/useMiniAppDetailBackAction";
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
import { EXPLORER_LABELS } from "../../labels";
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
  return <ExplorerSyncStateBadge online={isOnline} syncState={syncState} />;
}

interface ExplorerBlobBrowserPanelProps {
  blobStore: BlobStore;
  domainScope: DomainScope;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  online: boolean;
  organizationNamesById?: ReadonlyMap<string, string> | undefined;
  // When set, the panel runs in pick mode: rows resolve the pick (instead of
  // opening blob detail) and the list is filtered to image blobs.
  pickTarget?: BlobPickTarget | null | undefined;
  onCancelBlobPick: () => void;
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
  online: boolean;
  organizationNamesById?: ReadonlyMap<string, string> | undefined;
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
  const backAction = useMemo(
    () =>
      data.isListDetail
        ? {
            label: EXPLORER_LABELS.blobBrowserBackAction,
            onBack: data.handleBackToList,
            // In windowed mode the route-level blob action remains registered
            // underneath this local drill-in action. Prefer this one first;
            // once it returns to the list, the route action returns to the
            // surface that originally opened the Blob Browser.
            priority: 200,
          }
        : null,
    [data.handleBackToList, data.isListDetail],
  );

  useMiniAppDetailBackAction(backAction);

  return (
    <>
      <BlobBrowserHeader selectedBlob={data.selectedBlob} />
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
          bleed
          blobInfo={data.blobInfo}
          blobStore={params.blobStore}
          compact={data.compact}
          downloadMessage={downloadMessage}
          frameRef={data.frameRef}
          isWindowPending={data.isWindowPending}
          onQueryChange={data.handleQueryChange}
          onRowContextMenu={openContextMenu}
          onSelectBlob={data.handleSelectBlob}
          onSort={data.handleSort}
          online={params.online}
          organizationNamesById={params.organizationNamesById}
          query={data.query}
          renderSyncCell={renderExplorerSyncCell}
          rowHeight={data.rowHeight}
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
  const onCancel = params.onCancelBlobPick;
  const pickBackAction = useMemo(
    () =>
      params.pickTarget && pickBlob
        ? {
            label: EXPLORER_LABELS.blobBrowserBackAction,
            onBack: onCancel,
            // Pick state is internal rather than history-backed. Its Back must
            // cancel and clear that state before the route-level action runs.
            priority: 200,
          }
        : null,
    [onCancel, params.pickTarget, pickBlob],
  );

  useMiniAppDetailBackAction(pickBackAction);

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--blob-browser"
      key={`${params.route.blobId ?? ""}:${params.route.storageKey ?? ""}`}
    >
      {params.pickTarget && pickBlob ? (
        <BlobPickSurface
          bleed
          blobStore={params.blobStore}
          loadBlobInfo={params.loadBlobInfo}
          onCancel={onCancel}
          online={params.online}
          onPickBlob={pickBlob}
          organizationNamesById={params.organizationNamesById}
          renderSyncCell={renderExplorerSyncCell}
          slotLabel={params.pickTarget.slotLabel}
        />
      ) : (
        <BlobBrowserBrowseScreen
          blobStore={params.blobStore}
          containerNamesById={containerNamesById}
          data={data}
          online={params.online}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          organizationNamesById={params.organizationNamesById}
          selectDocumentProjection={params.selectDocumentProjection}
        />
      )}
    </MiniAppPanel>
  );
}
