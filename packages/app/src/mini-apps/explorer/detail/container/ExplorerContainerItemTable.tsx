import type {
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortKey,
  ContainerNode,
} from "@symcrypt/client-sdk";
import { type DragEvent, type MouseEvent, useMemo } from "react";
import {
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppTable,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../../components/mini-app/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import type { AvatarUrlByContactId } from "../../../../document-types/contact/useContactAvatarUrls";
import type { ExplorerContextMenuTarget } from "../../context-menu/ExplorerContextMenu";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../../labels";
import {
  type ExplorerItemColumnId,
  getVisibleExplorerItemColumnIds,
  TOGGLEABLE_COLUMN_IDS,
} from "./explorerItemColumnIds";
import {
  type ExplorerItemCellContext,
  getExplorerItemTableColumns,
  openExplorerItem,
  renderExplorerItemCell,
} from "./explorerItemTableColumns";

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
    case "summary":
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

// The row's params are its cell context plus the table-level column list and
// selection flag, so cells receive the params object directly.
function ExplorerContainerItemTableRow(
  params: ExplorerItemCellContext & {
    columnIds: ReadonlyArray<ExplorerItemColumnId>;
    selected: boolean;
  },
) {
  return (
    <MiniAppTableRow
      className="explorer-item-table-row"
      interactive
      onActivate={() => openExplorerItem(params)}
      onContextMenu={(event) => params.onItemContextMenu(event, params.row)}
      selected={params.selected}
    >
      {params.columnIds.map((columnId) =>
        renderExplorerItemCell(columnId, params),
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

function ExplorerContainerItemTableBody(
  params: Omit<ExplorerItemCellContext, "row"> & {
    columnIds: ReadonlyArray<ExplorerItemColumnId>;
    columns: ReadonlyArray<MiniAppTableColumn>;
    contextTarget: ExplorerContextMenuTarget | null;
    emptyLabel: string;
    error: string | null;
    isLoading: boolean;
    rows: ReadonlyArray<ContainerItemRow>;
    rowHeight: number;
    rowOffset: number;
    totalCount: number;
  },
) {
  const {
    columns,
    contextTarget,
    emptyLabel,
    error,
    isLoading,
    rows,
    rowHeight,
    rowOffset,
    totalCount,
    ...rowContext
  } = params;
  const topPadding = rowOffset * rowHeight;
  const bottomPadding =
    Math.max(0, totalCount - rowOffset - rows.length) * rowHeight;

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
            {...rowContext}
            row={row}
            selected={isExplorerContainerItemContextTarget(row, contextTarget)}
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
          {emptyLabel}
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
  // Both resolved by ExplorerContainerDetail, which owns the scroll frame and
  // therefore the only measurement of it. Deriving either here would risk a
  // second answer that disagrees with the one the window query already used.
  compact: boolean;
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  contextTarget: ExplorerContextMenuTarget | null;
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  dragActive: boolean;
  dragDisabled: boolean;
  emptyLabel: string;
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
  onBlankContextMenu:
    | ((event: MouseEvent<HTMLElement>, containerId: string) => void)
    | undefined;
  onItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  onSort: (key: ContainerItemSortKey) => void;
  rows: ReadonlyArray<ContainerItemRow>;
  rowHeight: number;
  rowOffset: number;
  selectedNode: ContainerNode;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  sort: ContainerItemSort;
  toggleColumn: (id: ExplorerItemColumnId) => void;
  totalCount: number;
}

function useExplorerContainerItemTableColumns({
  compact,
  hiddenColumns,
  onSort,
  sort,
  toggleColumn,
}: Pick<
  ItemTableProps,
  "compact" | "hiddenColumns" | "onSort" | "sort" | "toggleColumn"
>) {
  // `compact` folds the data columns into one two-line summary column. The
  // trailing kebab is not layout-dependent: every tier carries it.
  const columnIds = useMemo(
    () => getVisibleExplorerItemColumnIds({ compact, hiddenColumns }),
    [compact, hiddenColumns],
  );
  const columns = useMemo(() => {
    const columnMenu = compact ? null : (
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
    );

    // The kebab column is the table's trailing edge, so the column-menu button
    // rides in its header to stay flush right — on the last data column it
    // would sit one narrow column in from the edge.
    return [
      ...getExplorerItemTableColumns({
        columnIds: columnIds.filter((id) => id !== "actions"),
        onSort,
        sort,
      }),
      ...getExplorerItemTableColumns({
        columnIds: ["actions"],
        columnMenu,
        onSort,
        sort,
      }),
    ];
  }, [compact, columnIds, hiddenColumns, onSort, sort, toggleColumn]);

  return { columnIds, columns };
}

function getExplorerItemTableFrameClassName(params: {
  compact: boolean;
  dragActive: boolean;
}): string | undefined {
  return classNames(
    "explorer-item-table-wrap",
    "mini-app-table-frame--virtual",
    "mini-app-table-frame--compact",
    "mini-app-table-frame--bleed",
    // The item list fills its route, so it also bleeds its bottom edge to sit
    // flush against the mobile task bar.
    "mini-app-table-frame--bleed-block-end",
    // Phone rows fold onto two lines and take the taller pitch; the shared
    // modifier restores it over the routed 44px floor.
    params.compact && "mini-app-table-frame--two-line",
    params.dragActive && "explorer-item-table-wrap--drop-active",
  );
}

function createExplorerItemTableBlankContextMenuHandler(
  onBlankContextMenu: ItemTableProps["onBlankContextMenu"],
  selectedNodeId: string,
) {
  return (event: MouseEvent<HTMLDivElement>) => {
    if (!isExplorerItemTableBlankContextTarget(event.target)) {
      return;
    }

    event.preventDefault();
    onBlankContextMenu?.(event, selectedNodeId);
  };
}

export function ExplorerContainerItemTable(params: ItemTableProps) {
  const {
    compact,
    contactAvatarUrlByLocalId,
    contextTarget,
    currentSigningFingerprint,
    currentSelfContactLocalId,
    currentUserId,
    dragActive,
    dragDisabled,
    emptyLabel,
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
    rowHeight,
    rowOffset,
    selectedNode,
    selectDocumentProjection,
    setSelectedId,
    sort,
    toggleColumn,
  } = params;
  const { columnIds, columns } = useExplorerContainerItemTableColumns({
    compact,
    hiddenColumns,
    onSort,
    sort,
    toggleColumn,
  });
  return (
    <MiniAppTableFrame
      aria-busy={isImporting}
      className={getExplorerItemTableFrameClassName({ compact, dragActive })}
      onDragEnter={dragDisabled ? undefined : handleDragEnter}
      onDragLeave={dragDisabled ? undefined : handleDragLeave}
      onDragOver={dragDisabled ? undefined : handleDragOver}
      onContextMenu={createExplorerItemTableBlankContextMenuHandler(
        onBlankContextMenu,
        selectedNode.id,
      )}
      onDrop={dragDisabled ? undefined : handleDrop}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable
        aria-label={getExplorerItemTableLabel(selectedNode.name)}
        columns={columns}
      >
        <ExplorerContainerItemTableBody
          columnIds={columnIds}
          columns={columns}
          contactAvatarUrlByLocalId={contactAvatarUrlByLocalId}
          contextTarget={contextTarget}
          currentSigningFingerprint={currentSigningFingerprint}
          currentSelfContactLocalId={currentSelfContactLocalId}
          currentUserId={currentUserId}
          error={error}
          emptyLabel={emptyLabel}
          isLoading={isLoading}
          online={online}
          onItemContextMenu={onItemContextMenu}
          rows={rows}
          rowHeight={rowHeight}
          rowOffset={rowOffset}
          selectDocumentProjection={selectDocumentProjection}
          setSelectedId={setSelectedId}
          totalCount={params.totalCount}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
