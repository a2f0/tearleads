import type {
  ContainerDocumentQueries,
  ContainerItemSort,
  ContainerNode,
} from "@tearleads/client-sdk";
import { type MouseEvent, useCallback, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { useMiniAppVirtualWindow } from "../../../components/shared/MiniAppVirtual";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import { ExplorerSyncStateBadge } from "../ExplorerSyncStateBadge";
import { useExplorerContainerFileDropTarget } from "../hooks/useExplorerContainerFileDropTarget";
import { EXPLORER_LABELS } from "../labels";
import {
  EXPLORER_VIRTUAL_ROW_HEIGHT,
  ExplorerContainerItemTable,
  getNextExplorerItemSort,
  useExplorerContainerItemWindow,
} from "./ExplorerContainerItemTable";

export { getNextExplorerItemSort } from "./ExplorerContainerItemTable";

function ExplorerContainerDetailHeader(params: {
  online: boolean;
  selectedNode: ContainerNode;
}) {
  const { online, selectedNode } = params;

  return (
    <MiniAppHeader>
      <MiniAppHeaderCopy>
        <div className="explorer-detail-title-row">
          <strong>{selectedNode.name}</strong>
          <ExplorerSyncStateBadge
            online={online}
            showSynced
            syncState={selectedNode.syncState}
          />
        </div>
        <span>{EXPLORER_LABELS.folderType}</span>
      </MiniAppHeaderCopy>
    </MiniAppHeader>
  );
}

export function ExplorerContainerDetail(params: {
  containerListRevision: unknown;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  importDroppedFiles: ImportExplorerDroppedFiles;
  online: boolean;
  onContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    containerId: string,
  ) => void;
  refreshError: string | null;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  selectedNode: ContainerNode;
  setSelectedId: (id: string | null) => void;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}) {
  const {
    containerListRevision,
    documentListRevision,
    documentQueries,
    importDroppedFiles,
    online,
    onContainerContextMenu,
    refreshError,
    selectDocumentProjection,
    selectedNode,
    setSelectedId,
    visibleSystemSlots,
  } = params;
  const [sort, setSort] = useState<ContainerItemSort>({
    direction: "asc",
    key: "name",
  });
  const resetKey = `${selectedNode.id}:${sort.key}:${sort.direction}`;
  const { frameRef, limit, offset } = useMiniAppVirtualWindow({
    resetKey,
    rowHeight: EXPLORER_VIRTUAL_ROW_HEIGHT,
  });
  const itemWindow = useExplorerContainerItemWindow({
    containerListRevision,
    documentListRevision,
    documentQueries,
    enabled: true,
    limit,
    offset,
    selectedNode,
    sort,
    visibleSystemSlots,
  });
  const isShowingRequestedWindow = itemWindow.offset === offset;
  const rows = isShowingRequestedWindow ? itemWindow.rows : [];
  const rowOffset = isShowingRequestedWindow ? itemWindow.offset : offset;
  const handleSort = useCallback((key: ContainerItemSort["key"]) => {
    setSort((currentSort) => getNextExplorerItemSort(currentSort, key));
  }, []);
  const fileDropTarget = useExplorerContainerFileDropTarget({
    importDroppedFiles,
    selectedNode,
  });

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--container"
      key={selectedNode.id}
      variant="framed"
    >
      <ExplorerContainerDetailHeader
        online={online}
        selectedNode={selectedNode}
      />
      {refreshError ? (
        <MiniAppStatus as="span" tone="error">
          {refreshError}
        </MiniAppStatus>
      ) : null}
      {fileDropTarget.importStatus ? (
        <MiniAppStatus
          as="span"
          tone={fileDropTarget.importStatusIsError ? "error" : "muted"}
        >
          {fileDropTarget.importStatus}
        </MiniAppStatus>
      ) : null}
      <ExplorerContainerItemTable
        dragActive={fileDropTarget.dragActive}
        error={itemWindow.error}
        frameRef={frameRef}
        handleDragEnter={fileDropTarget.handleDragEnter}
        handleDragLeave={fileDropTarget.handleDragLeave}
        handleDragOver={fileDropTarget.handleDragOver}
        handleDrop={fileDropTarget.handleDrop}
        isImporting={fileDropTarget.isImporting}
        isLoading={itemWindow.isLoading}
        online={online}
        onBlankContextMenu={onContainerContextMenu}
        onSort={handleSort}
        rowOffset={rowOffset}
        rows={rows}
        selectedNode={selectedNode}
        selectDocumentProjection={selectDocumentProjection}
        setSelectedId={setSelectedId}
        sort={sort}
        totalCount={itemWindow.totalCount}
      />
    </MiniAppPanel>
  );
}
