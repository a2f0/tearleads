import type {
  ContainerDocumentQueries,
  ContainerItemRow,
  ContainerItemSort,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useLongPress } from "@tearleads/windowing";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import {
  getMiniAppItemGridColumns,
  getMiniAppItemGridItemWindow,
} from "../../../../components/mini-app/item-view/MiniAppItemGrid";
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
import { useExplorerContainerFileDropTarget } from "../../hooks/useExplorerContainerFileDropTarget";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerIcon } from "../../shared/ExplorerContainerIcon";
import { ExplorerSyncStateBadge } from "../../shared/ExplorerSyncStateBadge";
import { ExplorerContainerItemGrid } from "../item-views/ExplorerContainerItemGrid";
import { useExplorerItemView } from "../item-views/explorerItemViewContext";
import { ExplorerRecoveryFolders } from "../recovery/ExplorerRecoveryFolders";
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";
import {
  getNextExplorerItemSort,
  useExplorerContainerItemWindow,
  useExplorerItemTableLayout,
} from "./explorerContainerItemWindow";
import { useExplorerColumnVisibility } from "./useExplorerColumnVisibility";
import "./ExplorerContainerDetail.css";
import "../ExplorerDetailHeaderIdentity.css";

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
  const longPress = useLongPress(!recoveryCollection);
  const openContextMenu = recoveryCollection
    ? undefined
    : (event: MouseEvent<HTMLElement>) => {
        params.onContainerContextMenu(event, selectedNode.id);
      };
  // The current folder has no row in its own listing. Its header opens the same
  // menu as the sidebar row, including for root folders.
  const actionsLabel = `${EXPLORER_LABELS.containerHeaderActionsLabel}: ${selectedNode.name}`;

  return (
    <MiniAppHeader>
      <section
        {...longPress}
        aria-label={selectedNode.name}
        className="explorer-detail-header-identity"
        data-context-menu={!recoveryCollection}
        onContextMenu={openContextMenu}
      >
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
      </section>
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
            onClick={openContextMenu}
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
  onRecoveryChanged: () => void;
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
  const view = useExplorerItemView();
  // Between the two row views the window keeps the top row in place (the
  // pitch change rescales the offset). The grid counts lines of several items
  // each, so a switch to or from it starts again at the top.
  const resetKey = [
    params.selectedNode.id,
    sort.key,
    sort.direction,
    view === "grid" ? "grid" : "rows",
  ].join(":");
  // This pane owns the scroll frame, so it is the only place that can measure
  // it — the pitch is then handed to the item table as a prop rather than
  // re-derived there, because two derivations that disagree would leave the
  // requested and served offsets apart and blank the list.
  //
  // The measured width only ever crosses a threshold, never feeds the pitch
  // continuously, so a drag re-issues the window query at most once per fold
  // rather than once per pixel.
  const [narrowFrame, setNarrowFrame] = useState(false);
  const { compact, rowHeight } = useExplorerItemTableLayout(narrowFrame, view);
  const { frameRef, frameWidth, limit, offset } = useMiniAppVirtualWindow({
    resetKey,
    rowHeight,
  });
  // A table line holds one item; a grid line holds as many tiles as the
  // measured frame fits, and the window fetches whole lines of them.
  const columns = view === "grid" ? getMiniAppItemGridColumns(frameWidth) : 1;
  const itemRange = getMiniAppItemGridItemWindow({ columns, limit, offset });

  useEffect(() => {
    setNarrowFrame((current) => shouldFoldCompactRows(frameWidth, current));
  }, [frameWidth]);
  // The served rows stay on screen at the offset they were fetched for while the
  // next scroll window loads, so a scroll that crosses a row boundary moves
  // them rather than blanking the list until the query lands. Blanking unmounted
  // every row on each boundary: the list flashed empty and the row under a
  // trackpad pointer lost and regained its hover highlight as it scrolled.
  const itemWindow = useExplorerContainerItemWindow({
    ...params,
    enabled: true,
    limit: itemRange.limit,
    offset: itemRange.offset,
    sort,
  });
  const handleSort = useCallback((key: ContainerItemSort["key"]) => {
    setSort((currentSort) => getNextExplorerItemSort(currentSort, key));
  }, []);

  return {
    columns,
    compact,
    frameRef,
    handleSort,
    itemWindow,
    rowHeight,
    sort,
    view,
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

// The table reports a failed window load in place of rows, so a failure while
// rows from an earlier window stay on screen would render nothing — and those
// rows can sit off-screen once the scroll has moved past them. Report it above
// the list instead, where it is visible at any scroll position.
function ExplorerContainerWindowError(params: {
  error: string | null;
  rowCount: number;
}) {
  if (!params.error || params.rowCount === 0) {
    return null;
  }

  return (
    <MiniAppStatus as="span" tone="error">
      {params.error}
    </MiniAppStatus>
  );
}

// The item list in the chosen view: the table draws both row sizes, the grid
// draws tiles. Both take the same window, handlers, and drop target.
function ExplorerContainerItemList(props: {
  columnVisibility: ReturnType<typeof useExplorerColumnVisibility>;
  fileDropTarget: ReturnType<typeof useExplorerContainerFileDropTarget>;
  items: ReturnType<typeof useExplorerContainerItems>;
  params: ExplorerContainerDetailProps;
  recoveryCollection: boolean;
}) {
  const { fileDropTarget, items, params, recoveryCollection } = props;
  const listProps = {
    contactAvatarUrlByLocalId: params.contactAvatarUrlByLocalId,
    contextTarget: params.contextTarget,
    currentSigningFingerprint: params.currentSigningFingerprint,
    currentSelfContactLocalId: params.currentSelfContactLocalId,
    currentUserId: params.currentUserId,
    dragActive: fileDropTarget.dragActive,
    dragDisabled: recoveryCollection,
    emptyLabel: getExplorerContainerEmptyLabel(recoveryCollection),
    error: items.itemWindow.error,
    frameRef: items.frameRef,
    handleDragEnter: fileDropTarget.handleDragEnter,
    handleDragLeave: fileDropTarget.handleDragLeave,
    handleDragOver: fileDropTarget.handleDragOver,
    handleDrop: fileDropTarget.handleDrop,
    isImporting: fileDropTarget.isImporting,
    isLoading: items.itemWindow.isLoading,
    online: params.online,
    onBlankContextMenu: recoveryCollection
      ? undefined
      : params.onContainerContextMenu,
    onItemContextMenu: params.onItemContextMenu,
    onSort: items.handleSort,
    rowHeight: items.rowHeight,
    rowOffset: items.itemWindow.offset,
    rows: items.itemWindow.rows,
    selectedNode: params.selectedNode,
    selectDocumentProjection: params.selectDocumentProjection,
    setSelectedId: params.setSelectedId,
    sort: items.sort,
    totalCount: items.itemWindow.totalCount,
  };

  return items.view === "grid" ? (
    <ExplorerContainerItemGrid {...listProps} columns={items.columns} />
  ) : (
    <ExplorerContainerItemTable
      {...listProps}
      compact={items.compact}
      hiddenColumns={props.columnVisibility.hiddenColumns}
      toggleColumn={props.columnVisibility.toggleColumn}
      view={items.view}
    />
  );
}

export function ExplorerContainerDetail(params: ExplorerContainerDetailProps) {
  const { online, uploadManager, selectedNode } = params;
  const recoveryCollection = isExplorerOrphanedDocumentsId(selectedNode.id);
  const items = useExplorerContainerItems(params);
  const { itemWindow } = items;
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
        onContainerContextMenu={params.onContainerContextMenu}
        recoveryCollection={recoveryCollection}
        selectedNode={selectedNode}
        showHeaderSyncIndicator={params.showHeaderSyncIndicator}
      />
      {params.refreshError ? (
        <MiniAppStatus as="span" tone="error">
          {params.refreshError}
        </MiniAppStatus>
      ) : null}
      {recoveryCollection ? (
        <ExplorerRecoveryFolders
          {...params}
          currentOrganizationId={params.currentOrganizationId ?? null}
        />
      ) : null}
      <ExplorerContainerImportStatus fileDropTarget={fileDropTarget} />
      <ExplorerContainerWindowError
        error={itemWindow.error}
        rowCount={itemWindow.rows.length}
      />
      <ExplorerContainerItemList
        columnVisibility={columnVisibility}
        fileDropTarget={fileDropTarget}
        items={items}
        params={params}
        recoveryCollection={recoveryCollection}
      />
    </MiniAppPanel>
  );
}
