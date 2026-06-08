import type {
  ContainerDocumentQueries,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import { getStoredDocumentTypeLabel } from "@tearleads/client-sdk";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { classNames } from "../../../components/shared/classNames";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
} from "../../../components/shared/MiniAppVirtual";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { ExplorerSyncStateBadge } from "../ExplorerSyncStateBadge";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../labels";

export const EXPLORER_VIRTUAL_ROW_HEIGHT =
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT;

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
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

function getExplorerContainerItemRowKey(row: ContainerItemRow): string {
  return row.itemKind === "container"
    ? `container:${row.id}`
    : `document:${row.localId}:${row.containerId}`;
}

export function useExplorerContainerItemWindow(params: {
  containerListRevision: unknown;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  enabled: boolean;
  limit: number;
  offset: number;
  selectedNode: ContainerNode;
  sort: ContainerItemSort;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}) {
  const {
    containerListRevision,
    documentListRevision,
    documentQueries,
    enabled,
    limit,
    offset,
    selectedNode,
    sort,
    visibleSystemSlots,
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

    void documentQueries
      .listContainerItemWindow({
        containerId: selectedNode.id,
        limit,
        offset,
        sort,
        visibleSystemSlots: Array.from(visibleSystemSlots),
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
    containerListRevision,
    documentListRevision,
    documentQueries,
    enabled,
    limit,
    offset,
    selectedNode.id,
    sort,
    visibleSystemSlots,
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

export function ExplorerContainerItemTable(params: {
  dragActive: boolean;
  error: string | null;
  frameRef: (frame: HTMLDivElement | null) => void;
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
        "mini-app-table-frame--virtual",
        dragActive && "explorer-item-table-wrap--drop-active",
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(EXPLORER_VIRTUAL_ROW_HEIGHT)}
    >
      <MiniAppTable
        aria-label={getExplorerItemTableLabel(selectedNode.name)}
        columns={columns}
      >
        {topPadding > 0 ? (
          <MiniAppVirtualTableSpacerRow
            colSpan={columns.length}
            height={topPadding}
          />
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
          <MiniAppVirtualTableSpacerRow
            colSpan={columns.length}
            height={bottomPadding}
          />
        ) : null}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
