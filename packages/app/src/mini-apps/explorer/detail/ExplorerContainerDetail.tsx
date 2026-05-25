import type {
  ContainerDocumentReadModel,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@tearleads/client-sdk/documents";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { classNames } from "../../../components/shared/classNames";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../components/shared/MiniAppTable";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../../document-types/projectors";
import { DOCUMENT_TYPE_DEFINITIONS } from "../../../document-types/registry";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { ExplorerSyncStateBadge } from "../ExplorerSyncStateBadge";
import { useExplorerContainerFileDropTarget } from "../hooks/useExplorerContainerFileDropTarget";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../labels";

const EXPLORER_VIRTUAL_ROW_HEIGHT = 36;
const EXPLORER_VIRTUAL_OVERSCAN_ROWS = 8;
const EXPLORER_VIRTUAL_MIN_WINDOW_ROWS = 24;

function getSortAria(
  sort: ContainerItemSort,
  key: ContainerItemSortKey,
): MiniAppTableColumn["ariaSort"] {
  if (sort.key !== key) {
    return "none";
  }

  return sort.direction === "asc" ? "ascending" : "descending";
}

export function getNextExplorerItemSort(
  currentSort: ContainerItemSort,
  key: ContainerItemSortKey,
): ContainerItemSort {
  if (currentSort.key === key) {
    return {
      direction: currentSort.direction === "asc" ? "desc" : "asc",
      key,
    };
  }

  return {
    direction: key === "name" || key === "type" ? "asc" : "desc",
    key,
  };
}

function ExplorerSortableTableHeader(params: {
  activeDirection: ContainerItemSortDirection | null;
  label: string;
  onClick: () => void;
}) {
  const { activeDirection, label, onClick } = params;

  return (
    <button
      type="button"
      className="explorer-table-sort-button"
      onClick={onClick}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="explorer-table-sort-indicator">
        {activeDirection === "asc"
          ? "^"
          : activeDirection === "desc"
            ? "v"
            : ""}
      </span>
    </button>
  );
}

function getExplorerItemTableColumns(params: {
  onSort: (key: ContainerItemSortKey) => void;
  sort: ContainerItemSort;
}): ReadonlyArray<MiniAppTableColumn> {
  const { onSort, sort } = params;
  const sortableHeader = (key: ContainerItemSortKey, label: string) => (
    <ExplorerSortableTableHeader
      activeDirection={sort.key === key ? sort.direction : null}
      label={label}
      onClick={() => onSort(key)}
    />
  );

  return [
    {
      id: "name",
      header: EXPLORER_LABELS.itemNameColumn,
      width: "40%",
    },
    {
      ariaSort: getSortAria(sort, "type"),
      id: "type",
      header: sortableHeader("type", EXPLORER_LABELS.itemTypeColumn),
      width: "8rem",
    },
    {
      id: "sync",
      header: EXPLORER_LABELS.itemSyncColumn,
      width: "7rem",
    },
    {
      ariaSort: getSortAria(sort, "created"),
      id: "created",
      header: sortableHeader("created", EXPLORER_LABELS.dateCreatedColumn),
      width: "11rem",
    },
    {
      ariaSort: getSortAria(sort, "modified"),
      id: "modified",
      header: sortableHeader("modified", EXPLORER_LABELS.dateModifiedColumn),
      width: "11rem",
    },
  ];
}

function getExplorerContainerItemTypeLabel(row: ContainerItemRow): string {
  if (row.itemKind === "container") {
    return EXPLORER_LABELS.folderType;
  }

  return getStoredDocumentTypeLabel(
    row.documentKind,
    APP_DOCUMENT_PROJECTOR_REGISTRY,
  );
}

function getExplorerContainerItemRowKey(row: ContainerItemRow): string {
  return row.itemKind === "container"
    ? `container:${row.id}`
    : `document:${row.localId}:${row.containerId}`;
}

function useExplorerContainerItemViewport(frameRef: {
  current: HTMLDivElement | null;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const handleScroll = () => {
      setScrollTop(frame.scrollTop);
    };

    handleScroll();
    frame.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      frame.removeEventListener("scroll", handleScroll);
    };
  }, [frameRef]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    resizeObserver.observe(frame);
    setViewportHeight(frame.clientHeight);

    return () => {
      resizeObserver.disconnect();
    };
  }, [frameRef]);

  return { scrollTop, setScrollTop, viewportHeight };
}

function useExplorerContainerItemRange(params: {
  frameRef: { current: HTMLDivElement | null };
  resetKey: string;
}) {
  const { frameRef, resetKey } = params;
  const { scrollTop, setScrollTop, viewportHeight } =
    useExplorerContainerItemViewport(frameRef);

  useEffect(() => {
    setScrollTop(0);
    if (frameRef.current) {
      frameRef.current.scrollTop = 0;
    }
  }, [frameRef, resetKey, setScrollTop]);

  const visibleRows = Math.ceil(viewportHeight / EXPLORER_VIRTUAL_ROW_HEIGHT);
  const offset = Math.max(
    0,
    Math.floor(scrollTop / EXPLORER_VIRTUAL_ROW_HEIGHT) -
      EXPLORER_VIRTUAL_OVERSCAN_ROWS,
  );
  const limit = Math.max(
    EXPLORER_VIRTUAL_MIN_WINDOW_ROWS,
    visibleRows + EXPLORER_VIRTUAL_OVERSCAN_ROWS * 2,
  );

  return { limit, offset };
}

function useExplorerContainerItemWindow(params: {
  documentReadModel: ContainerDocumentReadModel;
  enabled: boolean;
  limit: number;
  offset: number;
  reloadKey: unknown;
  selectedNode: ContainerNode;
  sort: ContainerItemSort;
}) {
  const {
    documentReadModel,
    enabled,
    limit,
    offset,
    reloadKey,
    selectedNode,
    sort,
  } = params;
  const [state, setState] = useState<{
    error: string | null;
    isLoading: boolean;
    offset: number;
    rows: ReadonlyArray<ContainerItemRow>;
    totalCount: number;
  }>({
    error: null,
    isLoading: false,
    offset: 0,
    rows: [],
    totalCount: 0,
  });

  useEffect(() => {
    if (!enabled) {
      setState({
        error: null,
        isLoading: false,
        offset: 0,
        rows: [],
        totalCount: 0,
      });
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      error: null,
      isLoading: true,
    }));

    void documentReadModel
      .listContainerItemWindow({
        containerId: selectedNode.id,
        limit,
        offset,
        sort,
      })
      .then((window) => {
        if (cancelled) {
          return;
        }

        setState({
          error: null,
          isLoading: false,
          offset,
          rows: window.rows,
          totalCount: window.totalCount,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    documentReadModel,
    enabled,
    limit,
    offset,
    reloadKey,
    selectedNode.id,
    sort,
  ]);

  return state;
}

function ExplorerContainerItemName(params: {
  row: ContainerItemRow;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const { row, selectDocumentProjection, setSelectedId } = params;

  return (
    <MiniAppTableActionButton
      onClick={() => {
        if (row.itemKind === "container") {
          setSelectedId(row.id);
          return;
        }

        selectDocumentProjection(row.localId, row.containerId);
      }}
    >
      {row.name}
    </MiniAppTableActionButton>
  );
}

function ExplorerContainerItemTableRow(params: {
  online: boolean;
  row: ContainerItemRow;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const { online, row, selectDocumentProjection, setSelectedId } = params;

  return (
    <MiniAppTableRow>
      <MiniAppTableCell>
        <ExplorerContainerItemName
          row={row}
          selectDocumentProjection={selectDocumentProjection}
          setSelectedId={setSelectedId}
        />
      </MiniAppTableCell>
      <MiniAppTableCell>
        {getExplorerContainerItemTypeLabel(row)}
      </MiniAppTableCell>
      <MiniAppTableCell>
        <ExplorerSyncStateBadge
          online={online}
          showSynced
          syncState={row.syncState}
        />
      </MiniAppTableCell>
      <MiniAppTableCell title={row.createdAt ?? undefined}>
        {formatMiniAppDateTime(row.createdAt, {
          emptyFallback: EXPLORER_LABELS.unknownDate,
        })}
      </MiniAppTableCell>
      <MiniAppTableCell title={row.updatedAt ?? undefined}>
        {formatMiniAppDateTime(row.updatedAt, {
          emptyFallback: EXPLORER_LABELS.unknownDate,
        })}
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

function ExplorerContainerItemTable(params: {
  dragActive: boolean;
  error: string | null;
  frameRef: { current: HTMLDivElement | null };
  handleDragEnter: (event: DragEvent<HTMLElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLElement>) => void;
  handleDragOver: (event: DragEvent<HTMLElement>) => void;
  handleDrop: (event: DragEvent<HTMLElement>) => void;
  isImporting: boolean;
  isLoading: boolean;
  online: boolean;
  onSort: (key: ContainerItemSortKey) => void;
  rows: ReadonlyArray<ContainerItemRow>;
  rowOffset: number;
  selectedNode: ContainerNode;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  sort: ContainerItemSort;
  totalCount: number;
}) {
  const {
    dragActive,
    error,
    frameRef,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isImporting,
    isLoading,
    online,
    onSort,
    rows,
    rowOffset,
    selectedNode,
    selectDocumentProjection,
    setSelectedId,
    sort,
    totalCount,
  } = params;
  const columns = useMemo(
    () => getExplorerItemTableColumns({ onSort, sort }),
    [onSort, sort],
  );
  const topPadding = rowOffset * EXPLORER_VIRTUAL_ROW_HEIGHT;
  const bottomPadding =
    Math.max(0, totalCount - rowOffset - rows.length) *
    EXPLORER_VIRTUAL_ROW_HEIGHT;

  return (
    <MiniAppTableFrame
      aria-busy={isImporting}
      className={classNames(
        "explorer-item-table-wrap",
        dragActive && "explorer-item-table-wrap--drop-active",
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      ref={frameRef}
    >
      <MiniAppTable
        aria-label={getExplorerItemTableLabel(selectedNode.name)}
        columns={columns}
      >
        {topPadding > 0 ? (
          <MiniAppTableEmptyRow
            aria-hidden="true"
            className="explorer-virtual-spacer-row"
            colSpan={columns.length}
            style={{ height: topPadding }}
          >
            {""}
          </MiniAppTableEmptyRow>
        ) : null}
        {rows.length > 0 ? (
          rows.map((row) => (
            <ExplorerContainerItemTableRow
              key={getExplorerContainerItemRowKey(row)}
              online={online}
              row={row}
              selectDocumentProjection={selectDocumentProjection}
              setSelectedId={setSelectedId}
            />
          ))
        ) : isLoading ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            Loading...
          </MiniAppTableEmptyRow>
        ) : error ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {error}
          </MiniAppTableEmptyRow>
        ) : totalCount === 0 ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {EXPLORER_LABELS.itemTableEmpty}
          </MiniAppTableEmptyRow>
        ) : null}
        {bottomPadding > 0 ? (
          <MiniAppTableEmptyRow
            aria-hidden="true"
            className="explorer-virtual-spacer-row"
            colSpan={columns.length}
            style={{ height: bottomPadding }}
          >
            {""}
          </MiniAppTableEmptyRow>
        ) : null}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function ExplorerContainerDetailHeader(params: {
  online: boolean;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  selectedNode: ContainerNode;
}) {
  const { online, openInlineDocument, selectedNode } = params;

  return (
    <div className="explorer-detail-header">
      <div className="explorer-detail-copy">
        <div className="explorer-detail-title-row">
          <strong>{selectedNode.name}</strong>
          <ExplorerSyncStateBadge
            online={online}
            showSynced
            syncState={selectedNode.syncState}
          />
        </div>
        <span>{EXPLORER_LABELS.folderType}</span>
      </div>
      <MiniAppActions>
        {DOCUMENT_TYPE_DEFINITIONS.map((definition) => (
          <MiniAppButton
            key={definition.kind}
            onClick={() => {
              openInlineDocument(selectedNode.id, definition.kind);
            }}
          >
            {definition.createLabel}
          </MiniAppButton>
        ))}
      </MiniAppActions>
    </div>
  );
}

export function ExplorerContainerDetail(params: {
  documentListRevision: number;
  documentReadModel: ContainerDocumentReadModel;
  importDroppedFiles: ImportExplorerDroppedFiles;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  online: boolean;
  refreshError: string | null;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  selectedNode: ContainerNode;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    documentListRevision,
    documentReadModel,
    importDroppedFiles,
    openInlineDocument,
    online,
    refreshError,
    selectDocumentProjection,
    selectedNode,
    setSelectedId,
  } = params;
  const [sort, setSort] = useState<ContainerItemSort>({
    direction: "asc",
    key: "name",
  });
  const frameRef = useRef<HTMLDivElement | null>(null);
  const resetKey = `${selectedNode.id}:${sort.key}:${sort.direction}`;
  const { limit, offset } = useExplorerContainerItemRange({
    frameRef,
    resetKey,
  });
  const itemWindow = useExplorerContainerItemWindow({
    documentReadModel,
    enabled: true,
    limit,
    offset,
    reloadKey: documentListRevision,
    selectedNode,
    sort,
  });
  const isShowingRequestedWindow = itemWindow.offset === offset;
  const rows = isShowingRequestedWindow ? itemWindow.rows : [];
  const rowOffset = isShowingRequestedWindow ? itemWindow.offset : offset;
  const handleSort = useCallback((key: ContainerItemSortKey) => {
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
        openInlineDocument={openInlineDocument}
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
