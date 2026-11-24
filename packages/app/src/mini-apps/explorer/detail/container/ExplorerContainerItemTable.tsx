import type { ContainerItemRow } from "@tearleads/client-sdk";
import { useMemo } from "react";
import type { MiniAppItemView } from "../../../../components/mini-app/item-view/miniAppItemView";
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
import type { ExplorerContextMenuTarget } from "../../context-menu/ExplorerContextMenu";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../../labels";
import {
  type ExplorerItemListProps,
  getExplorerContainerItemRowKey,
  getExplorerItemListFrameHandlers,
  getExplorerItemListStatus,
  isExplorerContainerItemContextTarget,
  openExplorerItem,
} from "../item-views/explorerItemList";
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
import "../../../../components/mini-app/item-view/MiniAppItemView.css";
import "../item-views/ExplorerItemListEdges.css";

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
  const status = getExplorerItemListStatus(params);
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
      ) : status ? (
        <MiniAppTableEmptyRow colSpan={columns.length}>
          {status}
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

interface ItemTableProps extends ExplorerItemListProps {
  // Both resolved by ExplorerContainerDetail, which owns the scroll frame and
  // therefore the only measurement of it. Deriving either here would risk a
  // second answer that disagrees with the one the window query already used.
  compact: boolean;
  hiddenColumns: ReadonlySet<ExplorerItemColumnId>;
  toggleColumn: (id: ExplorerItemColumnId) => void;
  // The table draws the two row views; the grid is its own component.
  view: Exclude<MiniAppItemView, "grid">;
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

export function ExplorerContainerItemTable(params: ItemTableProps) {
  const {
    compact,
    contactAvatarUrlByLocalId,
    contextTarget,
    currentSigningFingerprint,
    currentSelfContactLocalId,
    currentUserId,
    dragActive,
    frameRef,
    hiddenColumns,
    isImporting,
    online,
    onItemContextMenu,
    onSort,
    rowHeight,
    selectedNode,
    selectDocumentProjection,
    setSelectedId,
    sort,
    toggleColumn,
    view,
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
      {...getExplorerItemListFrameHandlers(params)}
      aria-busy={isImporting}
      className={getExplorerItemTableFrameClassName({ compact, dragActive })}
      data-item-view={view}
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
          error={params.error}
          emptyLabel={params.emptyLabel}
          isLoading={params.isLoading}
          largeRows={view === "large-rows"}
          online={online}
          onItemContextMenu={onItemContextMenu}
          rows={params.rows}
          rowHeight={rowHeight}
          rowOffset={params.rowOffset}
          selectDocumentProjection={selectDocumentProjection}
          setSelectedId={setSelectedId}
          totalCount={params.totalCount}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
