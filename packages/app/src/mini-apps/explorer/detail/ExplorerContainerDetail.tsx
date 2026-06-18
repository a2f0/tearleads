import type {
  ContainerDocumentQueries,
  ContainerItemRow,
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
import { ExplorerContainerItemTable } from "./ExplorerContainerItemTable";
import {
  EXPLORER_VIRTUAL_ROW_HEIGHT,
  getNextExplorerItemSort,
  useExplorerContainerItemWindow,
} from "./explorerContainerItemWindow";

export { getNextExplorerItemSort } from "./explorerContainerItemWindow";

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

interface ExplorerContainerDetailProps {
  containerListRevision: unknown;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  importDroppedFiles: ImportExplorerDroppedFiles;
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
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  selectedNode: ContainerNode;
  setSelectedId: (id: string | null) => void;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}

function useExplorerContainerItems(
  params: Pick<
    ExplorerContainerDetailProps,
    | "containerListRevision"
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
  const { frameRef, limit, offset } = useMiniAppVirtualWindow({
    resetKey,
    rowHeight: EXPLORER_VIRTUAL_ROW_HEIGHT,
  });
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
    frameRef,
    handleSort,
    itemWindow,
    rowOffset: isShowingRequestedWindow ? itemWindow.offset : offset,
    rows: isShowingRequestedWindow ? itemWindow.rows : [],
    sort,
  };
}

export function ExplorerContainerDetail(params: ExplorerContainerDetailProps) {
  const {
    importDroppedFiles,
    online,
    onContainerContextMenu,
    onItemContextMenu,
    refreshError,
    selectDocumentProjection,
    selectedNode,
    setSelectedId,
  } = params;
  const { frameRef, handleSort, itemWindow, rowOffset, rows, sort } =
    useExplorerContainerItems(params);
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
        onItemContextMenu={onItemContextMenu}
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
