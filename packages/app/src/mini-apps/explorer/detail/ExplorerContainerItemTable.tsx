import type {
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import { getStoredDocumentTypeLabel } from "@tearleads/client-sdk";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useMemo,
} from "react";
import { classNames } from "../../../components/shared/classNames";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../components/shared/MiniAppVirtual";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { ExplorerSyncStateBadge } from "../ExplorerSyncStateBadge";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../labels";
import { EXPLORER_VIRTUAL_ROW_HEIGHT } from "./explorerContainerItemWindow";

function getSortAria(
  sort: ContainerItemSort,
  key: ContainerItemSortKey,
): MiniAppTableColumn["ariaSort"] {
  if (sort.key !== key) {
    return "none";
  }

  return sort.direction === "asc" ? "ascending" : "descending";
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

function isExplorerItemKeyboardActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

function ExplorerContainerItemTableRow(params: {
  online: boolean;
  row: ContainerItemRow;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    online,
    onItemContextMenu,
    row,
    selectDocumentProjection,
    setSelectedId,
  } = params;
  const openItem = () => {
    if (row.itemKind === "container") {
      setSelectedId(row.id);
      return;
    }

    selectDocumentProjection(row.localId, row.containerId);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!isExplorerItemKeyboardActivationKey(event.key)) {
      return;
    }

    event.preventDefault();
    openItem();
  };

  return (
    <MiniAppTableRow
      aria-label={row.name}
      className="explorer-item-table-row"
      interactive
      onClick={openItem}
      onContextMenu={(event) => onItemContextMenu(event, row)}
      onKeyDown={handleRowKeyDown}
      role="button"
      tabIndex={0}
    >
      <MiniAppTableCell>
        <MiniAppTableText title={row.name}>{row.name}</MiniAppTableText>
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

function isExplorerItemTableBlankContextTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    !target.closest(
      "button, a, input, select, textarea, th, thead, .explorer-item-table-row",
    )
  );
}

function ExplorerContainerItemTableBody(params: {
  columns: ReadonlyArray<MiniAppTableColumn>;
  error: string | null;
  isLoading: boolean;
  online: boolean;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  rows: ReadonlyArray<ContainerItemRow>;
  rowOffset: number;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  totalCount: number;
}) {
  const {
    columns,
    error,
    isLoading,
    online,
    onItemContextMenu,
    rows,
    rowOffset,
    selectDocumentProjection,
    setSelectedId,
    totalCount,
  } = params;
  const topPadding = rowOffset * EXPLORER_VIRTUAL_ROW_HEIGHT;
  const bottomPadding =
    Math.max(0, totalCount - rowOffset - rows.length) *
    EXPLORER_VIRTUAL_ROW_HEIGHT;

  return (
    <>
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
            onItemContextMenu={onItemContextMenu}
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
    </>
  );
}

interface ItemTableProps {
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
  onBlankContextMenu: (
    event: MouseEvent<HTMLElement>,
    containerId: string,
  ) => void;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  onSort: (key: ContainerItemSortKey) => void;
  rows: ReadonlyArray<ContainerItemRow>;
  rowOffset: number;
  selectedNode: ContainerNode;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  sort: ContainerItemSort;
  totalCount: number;
}

export function ExplorerContainerItemTable(params: ItemTableProps) {
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
    onBlankContextMenu,
    onItemContextMenu,
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
      onContextMenu={(event) => {
        if (isExplorerItemTableBlankContextTarget(event.target)) {
          onBlankContextMenu(event, selectedNode.id);
        }
      }}
      onDrop={handleDrop}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(EXPLORER_VIRTUAL_ROW_HEIGHT)}
    >
      <MiniAppTable
        aria-label={getExplorerItemTableLabel(selectedNode.name)}
        columns={columns}
      >
        <ExplorerContainerItemTableBody
          columns={columns}
          error={error}
          isLoading={isLoading}
          online={online}
          onItemContextMenu={onItemContextMenu}
          rows={rows}
          rowOffset={rowOffset}
          selectDocumentProjection={selectDocumentProjection}
          setSelectedId={setSelectedId}
          totalCount={totalCount}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
