import type {
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortKey,
  ContainerNode,
} from "@tearleads/client-sdk";
import { type DragEvent, type MouseEvent, useMemo } from "react";
import { classNames } from "../../../components/shared/classNames";
import {
  addMiniAppTableHeaderAction,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppTable,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../components/shared/MiniAppVirtual";
import { useRoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import type { ExplorerContextMenuTarget } from "../context-menu/ExplorerContextMenu";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../labels";
import { EXPLORER_VIRTUAL_ROW_HEIGHT } from "./explorerContainerItemWindow";
import {
  type ExplorerItemColumnId,
  getVisibleExplorerItemColumnIds,
  TOGGLEABLE_COLUMN_IDS,
} from "./explorerItemColumnIds";
import {
  type ExplorerItemCellContext,
  getExplorerItemTableColumns,
  renderExplorerItemCell,
} from "./explorerItemTableColumns";
import "./ExplorerContainerItemTable.css";

function getExplorerContainerItemRowKey(row: ContainerItemRow): string {
  return row.itemKind === "container"
    ? `container:${row.id}`
    : `document:${row.localId}:${row.containerId}`;
}

function getExplorerItemColumnLabel(id: ExplorerItemColumnId): string {
  switch (id) {
    case "actions":
      return EXPLORER_LABELS.itemActionsColumn;
    case "name":
      return EXPLORER_LABELS.itemNameColumn;
    case "type":
      return EXPLORER_LABELS.itemTypeColumn;
    case "created":
      return EXPLORER_LABELS.dateCreatedColumn;
    case "modified":
      return EXPLORER_LABELS.dateModifiedColumn;
    case "sync":
      return EXPLORER_LABELS.itemSyncColumn;
  }
}

const EXPLORER_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<ExplorerItemColumnId>
> = TOGGLEABLE_COLUMN_IDS.map((id) => ({
  id,
  label: getExplorerItemColumnLabel(id),
}));

// The row right-clicked into the context menu stays highlighted while the menu
// is open: opening the menu does not move the selection (that would navigate the
// pane away), so without this the user loses track of which row the menu acts on.
function isExplorerContainerItemContextTarget(
  row: ContainerItemRow,
  contextTarget: ExplorerContextMenuTarget | null,
): boolean {
  if (!contextTarget) {
    return false;
  }

  if (row.itemKind === "container") {
    return (
      contextTarget.kind === "container" && contextTarget.containerId === row.id
    );
  }

  return (
    contextTarget.kind === "document" &&
    contextTarget.localId === row.localId &&
    contextTarget.containerId === row.containerId
  );
}

function ExplorerContainerItemTableRow(params: {
  columnIds: ReadonlyArray<ExplorerItemColumnId>;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  online: boolean;
  row: ContainerItemRow;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  selected: boolean;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    columnIds,
    currentSigningFingerprint,
    currentUserId,
    online,
    onItemContextMenu,
    row,
    selected,
    selectDocumentProjection,
    setSelectedId,
  } = params;
  const cellContext: ExplorerItemCellContext = {
    currentSigningFingerprint,
    currentUserId,
    online,
    onItemContextMenu,
    row,
    selectDocumentProjection,
    setSelectedId,
  };

  return (
    <MiniAppTableRow
      className="explorer-item-table-row"
      interactive
      onContextMenu={(event) => onItemContextMenu(event, row)}
      selected={selected}
    >
      {columnIds.map((columnId) =>
        renderExplorerItemCell(columnId, cellContext),
      )}
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
  columnIds: ReadonlyArray<ExplorerItemColumnId>;
  contextTarget: ExplorerContextMenuTarget | null;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  error: string | null;
  isLoading: boolean;
  online: boolean;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  rows: ReadonlyArray<ContainerItemRow>;
  rowOffset: number;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  totalCount: number;
}) {
  const {
    columnIds,
    contextTarget,
    currentSigningFingerprint,
    currentUserId,
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
          colSpan={columnIds.length}
          height={topPadding}
        />
      ) : null}
      {rows.length > 0 ? (
        rows.map((row) => (
          <ExplorerContainerItemTableRow
            key={getExplorerContainerItemRowKey(row)}
            columnIds={columnIds}
            currentSigningFingerprint={currentSigningFingerprint}
            currentUserId={currentUserId}
            online={online}
            onItemContextMenu={onItemContextMenu}
            row={row}
            selected={isExplorerContainerItemContextTarget(row, contextTarget)}
            selectDocumentProjection={selectDocumentProjection}
            setSelectedId={setSelectedId}
          />
        ))
      ) : isLoading ? (
        <MiniAppTableEmptyRow colSpan={columnIds.length}>
          Loading...
        </MiniAppTableEmptyRow>
      ) : error ? (
        <MiniAppTableEmptyRow colSpan={columnIds.length}>
          {error}
        </MiniAppTableEmptyRow>
      ) : totalCount === 0 ? (
        <MiniAppTableEmptyRow colSpan={columnIds.length}>
          {EXPLORER_LABELS.itemTableEmpty}
        </MiniAppTableEmptyRow>
      ) : null}
      {bottomPadding > 0 ? (
        <MiniAppVirtualTableSpacerRow
          colSpan={columnIds.length}
          height={bottomPadding}
        />
      ) : null}
    </>
  );
}

interface ItemTableProps {
  contextTarget: ExplorerContextMenuTarget | null;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  dragActive: boolean;
  error: string | null;
  frameRef: (frame: HTMLDivElement | null) => void;
  handleDragEnter: (event: DragEvent<HTMLElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLElement>) => void;
  handleDragOver: (event: DragEvent<HTMLElement>) => void;
  handleDrop: (event: DragEvent<HTMLElement>) => void;
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>;
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
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  sort: ContainerItemSort;
  toggleColumn: (id: ExplorerItemColumnId) => void;
  totalCount: number;
}

function useExplorerContainerItemTableColumns({
  hiddenColumns,
  onSort,
  sort,
  toggleColumn,
}: Pick<ItemTableProps, "hiddenColumns" | "onSort" | "sort" | "toggleColumn">) {
  const compact = useRoutedLayoutTier() === "mobile";
  const columnIds = useMemo(
    () => getVisibleExplorerItemColumnIds({ compact, hiddenColumns }),
    [compact, hiddenColumns],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        getExplorerItemTableColumns({ compact, hiddenColumns, onSort, sort }),
        compact ? null : (
          <MiniAppColumnMenuButton
            ariaLabel={EXPLORER_LABELS.columnsMenuButton}
            hiddenColumns={hiddenColumns}
            options={EXPLORER_COLUMN_MENU_OPTIONS}
            stateLabels={{
              off: EXPLORER_LABELS.columnsMenuStateOff,
              on: EXPLORER_LABELS.columnsMenuStateOn,
            }}
            toggleColumn={toggleColumn}
          />
        ),
      ),
    [compact, hiddenColumns, onSort, sort, toggleColumn],
  );

  return { columnIds, columns };
}

export function ExplorerContainerItemTable(params: ItemTableProps) {
  const {
    contextTarget,
    currentSigningFingerprint,
    currentUserId,
    dragActive,
    error,
    frameRef,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    hiddenColumns,
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
    toggleColumn,
    totalCount,
  } = params;
  const { columnIds, columns } = useExplorerContainerItemTableColumns({
    hiddenColumns,
    onSort,
    sort,
    toggleColumn,
  });

  return (
    <MiniAppTableFrame
      aria-busy={isImporting}
      className={classNames(
        "explorer-item-table-wrap",
        "mini-app-table-frame--virtual",
        "mini-app-table-frame--compact",
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
          columnIds={columnIds}
          contextTarget={contextTarget}
          currentSigningFingerprint={currentSigningFingerprint}
          currentUserId={currentUserId}
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
