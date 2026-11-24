import type { ContainerItemRow } from "@tearleads/client-sdk";
import {
  MiniAppItemGrid,
  MiniAppItemGridHeader,
  MiniAppItemTile,
} from "../../../../components/mini-app/item-view/MiniAppItemGrid";
import { MiniAppTableFrame } from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { getExplorerItemTableLabel } from "../../labels";
import { ExplorerCompactSortHeader } from "../ExplorerCompactSortHeader";
import {
  type ExplorerItemListProps,
  getExplorerContainerItemRowKey,
  getExplorerItemListFrameHandlers,
  getExplorerItemListStatus,
  isExplorerContainerItemContextTarget,
  openExplorerItem,
} from "./explorerItemList";
import {
  getExplorerContainerItemName,
  renderExplorerItemVisual,
} from "./explorerItemVisual";

function ExplorerContainerItemTile(
  params: ExplorerItemListProps & { row: ContainerItemRow },
) {
  const { row } = params;

  return (
    <MiniAppItemTile
      data-document-local-id={
        row.itemKind === "document" ? row.localId : undefined
      }
      label={getExplorerContainerItemName(params)}
      onClick={() => openExplorerItem(params)}
      onContextMenu={(event) => params.onItemContextMenu(event, row)}
      selected={isExplorerContainerItemContextTarget(row, params.contextTarget)}
      visual={renderExplorerItemVisual(params, "fill")}
    />
  );
}

/**
 * The grid view of a container's items: square tiles in lines, windowed the
 * way the table windows rows. The detail pane counts columns from the frame it
 * measured and fetches whole lines, so `rowOffset` and `rows` arrive in items
 * and `columns` turns them back into lines here.
 *
 * Sorting keeps the folded table's single sort menu, pinned above the tiles.
 */
export function ExplorerContainerItemGrid(
  params: ExplorerItemListProps & { columns: number },
) {
  return (
    <MiniAppTableFrame
      {...getExplorerItemListFrameHandlers(params)}
      aria-busy={params.isImporting}
      className={classNames(
        "explorer-item-grid-frame",
        "mini-app-table-frame--bleed",
        "mini-app-table-frame--edges",
        "mini-app-table-frame--bleed-block-end",
        params.dragActive && "explorer-item-grid-frame--drop-active",
      )}
      data-item-view="grid"
      ref={params.frameRef}
      style={getMiniAppVirtualFrameStyle(params.rowHeight)}
    >
      <MiniAppItemGridHeader>
        <ExplorerCompactSortHeader onSort={params.onSort} sort={params.sort} />
      </MiniAppItemGridHeader>
      <MiniAppItemGrid
        aria-label={getExplorerItemTableLabel(params.selectedNode.name)}
        columns={params.columns}
        getItemKey={getExplorerContainerItemRowKey}
        itemOffset={params.rowOffset}
        items={params.rows}
        renderItem={(row) => (
          <ExplorerContainerItemTile {...params} row={row} />
        )}
        status={getExplorerItemListStatus(params)}
        totalCount={params.totalCount}
      />
    </MiniAppTableFrame>
  );
}
