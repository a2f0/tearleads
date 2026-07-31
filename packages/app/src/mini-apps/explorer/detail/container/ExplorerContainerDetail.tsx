import type {
  ContainerDocumentQueries,
  ContainerItemRow,
  ContainerItemSort,
  ContainerNode,
} from "@tearleads/client-sdk";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowActionsButton,
  shouldFoldCompactRows,
} from "../../../../components/mini-app/MiniAppTable";
import { useMiniAppVirtualWindow } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import type { AvatarUrlByContactId } from "../../../../document-types/contact/useContactAvatarUrls";
import { isExplorerOrphanedDocumentsId } from "../../../../stores/explorer/orphanedDocuments";
import type { ExplorerContextMenuTarget } from "../../context-menu/ExplorerContextMenu";
import { ExplorerContainerIcon } from "../../ExplorerContainerIcon";
import { ExplorerSyncStateBadge } from "../../ExplorerSyncStateBadge";
import { useExplorerContainerFileDropTarget } from "../../hooks/useExplorerContainerFileDropTarget";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";
import {
  getNextExplorerItemSort,
  useExplorerContainerItemWindow,
  useExplorerItemTableLayout,
} from "./explorerContainerItemWindow";
import { useExplorerColumnVisibility } from "./useExplorerColumnVisibility";
import "./ExplorerContainerDetail.css";

export { getNextExplorerItemSort } from "./explorerContainerItemWindow";

function getExplorerContainerEmptyLabel(recoveryCollection: boolean): string {
  return recoveryCollection
    ? EXPLORER_LABELS.orphanedDocumentsEmpty
    : EXPLORER_LABELS.itemTableEmpty;
}

function ExplorerContainerDetailHeader(params: {
  online: boolean;
  onContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    containerId: string,
  ) => void;
  selectedNode: ContainerNode;
  recoveryCollection: boolean;
  showHeaderSyncIndicator: boolean;
}) {
  const { online, recoveryCollection, selectedNode, showHeaderSyncIndicator } =
    params;
  // The folder you are inside is the one thing on this pane with no row of its
  // own — the list below shows its children — so its overflow menu belongs on
  // the header that names it. It opens the same container menu the sidebar row
  // and the list's blank area do (Get Info, New Folder, Upload, Rename, Move,
  // Trash), which is the only way to reach a ROOT folder's own actions: a root
  // has no parent listing to open it from, and the sidebar offers folder actions
  // by right-click alone.
  const actionsLabel = `${EXPLORER_LABELS.containerHeaderActionsLabel}: ${selectedNode.name}`;

  return (
    <MiniAppHeader>
      <div className="explorer-detail-header-identity">
        {/* The same glyph the sidebar row and item table already show for this
            container, so the header names where you are the way the tree did. */}
        <ExplorerContainerIcon
          className="explorer-detail-header-icon"
          icon={selectedNode.icon}
          isOpen
        />
        <MiniAppHeaderCopy>
          <strong>{selectedNode.name}</strong>
          <span>
            {recoveryCollection
              ? EXPLORER_LABELS.orphanedDocumentsType
              : EXPLORER_LABELS.folderType}
          </span>
        </MiniAppHeaderCopy>
      </div>
      {/* Group the trailing controls: the header spreads its children apart, so
          a bare third child would strand the sync badge in the middle. */}
      {recoveryCollection ? null : (
        <MiniAppActions>
          {showHeaderSyncIndicator ? (
            <ExplorerSyncStateBadge
              online={online}
              syncState={selectedNode.syncState}
            />
          ) : null}
          <MiniAppRowActionsButton
            aria-label={actionsLabel}
            onClick={(event) => {
              params.onContainerContextMenu(event, selectedNode.id);
            }}
            title={actionsLabel}
          />
        </MiniAppActions>
      )}
    </MiniAppHeader>
  );
}

interface ExplorerContainerDetailProps {
  containerNodes: ReadonlyArray<ContainerNode>;
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  contextTarget: ExplorerContextMenuTarget | null;
  currentOrganizationId: string | null | undefined;
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  uploadManager: ExplorerUploadManager;
  online: boolean;
  onContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    containerId: string,
  ) => void;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  refreshError: string | null;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  selectedNode: ContainerNode;
  setSelectedId: (id: string | null) => void;
  showHeaderSyncIndicator: boolean;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}

function useExplorerContainerItems(
  params: Pick<
    ExplorerContainerDetailProps,
    | "containerNodes"
    | "currentOrganizationId"
    | "documentListRevision"
    | "documentQueries"
    | "selectedNode"
    | "visibleSystemSlots"
  >,
) {
  const [sort, setSort] = useState<ContainerItemSort>({
    direction: "asc",
    key: "name",
  });
  const resetKey = `${params.selectedNode.id}:${sort.key}:${sort.direction}`;
  // This pane owns the scroll frame, so it is the only place that can measure
  // it — the pitch is then handed to the item table as a prop rather than
  // re-derived there, because two derivations that disagree would leave the
  // requested and served offsets apart and blank the list.
  //
  // The measured width only ever crosses a threshold, never feeds the pitch
  // continuously, so a drag re-issues the window query at most once per fold
  // rather than once per pixel.
  const [narrowFrame, setNarrowFrame] = useState(false);
  const { compact, rowHeight } = useExplorerItemTableLayout(narrowFrame);
  const { frameRef, frameWidth, limit, offset } = useMiniAppVirtualWindow({
    resetKey,
    rowHeight,
  });

  useEffect(() => {
    setNarrowFrame((current) => shouldFoldCompactRows(frameWidth, current));
  }, [frameWidth]);
  const itemWindow = useExplorerContainerItemWindow({
    ...params,
    enabled: true,
    limit,
    offset,
    sort,
  });
  const isShowingRequestedWindow = itemWindow.offset === offset;
  const handleSort = useCallback((key: ContainerItemSort["key"]) => {
    setSort((currentSort) => getNextExplorerItemSort(currentSort, key));
  }, []);

  return {
    compact,
    frameRef,
    handleSort,
    itemWindow,
    rowHeight,
    rowOffset: isShowingRequestedWindow ? itemWindow.offset : offset,
    rows: isShowingRequestedWindow ? itemWindow.rows : [],
    sort,
  };
}

function ExplorerContainerImportStatus({
  fileDropTarget,
}: {
  fileDropTarget: ReturnType<typeof useExplorerContainerFileDropTarget>;
}) {
  if (!fileDropTarget.importStatus) {
    return null;
  }

  return (
    <MiniAppStatus
      as="span"
      className="explorer-detail-import-status"
      tone={fileDropTarget.importStatusIsError ? "error" : "muted"}
    >
      {fileDropTarget.importStatus}
      {fileDropTarget.canCancelImport ? (
        <MiniAppButton onClick={fileDropTarget.cancelImport} variant="ghost">
          {EXPLORER_LABELS.fileImportCancelAction}
        </MiniAppButton>
      ) : null}
    </MiniAppStatus>
  );
}

export function ExplorerContainerDetail(params: ExplorerContainerDetailProps) {
  const {
    contactAvatarUrlByLocalId,
    contextTarget,
    currentSigningFingerprint,
    currentSelfContactLocalId,
    currentUserId,
    online,
    uploadManager,
    onContainerContextMenu,
    onItemContextMenu,
    refreshError,
    selectDocumentProjection,
    selectedNode,
    setSelectedId,
  } = params;
  const recoveryCollection = isExplorerOrphanedDocumentsId(selectedNode.id);
  const {
    compact,
    frameRef,
    handleSort,
    itemWindow,
    rowHeight,
    rowOffset,
    rows,
    sort,
  } = useExplorerContainerItems(params);
  const columnVisibility = useExplorerColumnVisibility();
  const fileDropTarget = useExplorerContainerFileDropTarget({
    selectedNode,
    uploadManager,
  });

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--container"
      key={selectedNode.id}
    >
      <ExplorerContainerDetailHeader
        online={online}
        onContainerContextMenu={onContainerContextMenu}
        recoveryCollection={recoveryCollection}
        selectedNode={selectedNode}
        showHeaderSyncIndicator={params.showHeaderSyncIndicator}
      />
      {refreshError ? (
        <MiniAppStatus as="span" tone="error">
          {refreshError}
        </MiniAppStatus>
      ) : null}
      <ExplorerContainerImportStatus fileDropTarget={fileDropTarget} />
      <ExplorerContainerItemTable
        compact={compact}
        contactAvatarUrlByLocalId={contactAvatarUrlByLocalId}
        contextTarget={contextTarget}
        currentSigningFingerprint={currentSigningFingerprint}
        currentSelfContactLocalId={currentSelfContactLocalId}
        currentUserId={currentUserId}
        dragActive={fileDropTarget.dragActive}
        dragDisabled={recoveryCollection}
        emptyLabel={getExplorerContainerEmptyLabel(recoveryCollection)}
        error={itemWindow.error}
        frameRef={frameRef}
        handleDragEnter={fileDropTarget.handleDragEnter}
        handleDragLeave={fileDropTarget.handleDragLeave}
        handleDragOver={fileDropTarget.handleDragOver}
        handleDrop={fileDropTarget.handleDrop}
        hiddenColumns={columnVisibility.hiddenColumns}
        isImporting={fileDropTarget.isImporting}
        isLoading={itemWindow.isLoading}
        online={online}
        onBlankContextMenu={
          recoveryCollection ? undefined : onContainerContextMenu
        }
        onItemContextMenu={onItemContextMenu}
        onSort={handleSort}
        rowHeight={rowHeight}
        rowOffset={rowOffset}
        rows={rows}
        selectedNode={selectedNode}
        selectDocumentProjection={selectDocumentProjection}
        setSelectedId={setSelectedId}
        sort={sort}
        toggleColumn={columnVisibility.toggleColumn}
        totalCount={itemWindow.totalCount}
      />
    </MiniAppPanel>
  );
}
