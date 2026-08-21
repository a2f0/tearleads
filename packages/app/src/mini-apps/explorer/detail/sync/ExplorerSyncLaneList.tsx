import type { SyncLaneSnapshot } from "@symcrypt/client-sdk";
import { useMemo } from "react";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppColumnVisibility,
} from "../../../../components/mini-app/MiniAppTable";
import { useRoutedLayoutTier } from "../../../../navigation/useRoutedLayoutTier";
import { EXPLORER_LABELS, getExplorerSyncLaneCountLabel } from "../../labels";
import {
  ExplorerSyncLaneLastAction,
  ExplorerSyncLaneProgress,
  ExplorerSyncLaneStatusBadge,
} from "./ExplorerSyncLaneShared";
import {
  getSyncLaneCompactLabel,
  getSyncLanePhaseLabel,
} from "./ExplorerSyncLaneUtils";

type SyncLaneListColumnId =
  | "lane"
  | "phase"
  | "progress"
  | "last-action"
  | "counts"
  | "status";

const SYNC_LANE_LIST_COLUMN_IDS: ReadonlyArray<SyncLaneListColumnId> = [
  "lane",
  "phase",
  "progress",
  "last-action",
  "counts",
  "status",
];

// Phone-tier list keeps a trimmed, fixed set so the lane leads and the row fits
// without a horizontal scroll: the label identifies the lane and the status
// badge conveys its state. Everything else lives one tap away in the lane
// detail view. Column-visibility preferences do not apply here.
const SYNC_LANE_COMPACT_COLUMN_IDS: ReadonlyArray<SyncLaneListColumnId> = [
  "lane",
  "status",
];

const SYNC_LANE_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<SyncLaneListColumnId> = [
  "phase",
  "progress",
  "last-action",
  "counts",
  "status",
];

const SYNC_LANE_COLUMN_STORAGE_KEY =
  "symcrypt.explorer.sync-lanes:hidden-columns";

function getSyncLaneListColumnLabel(id: SyncLaneListColumnId): string {
  switch (id) {
    case "lane":
      return EXPLORER_LABELS.syncLanesLaneColumn;
    case "phase":
      return EXPLORER_LABELS.syncLanesPhaseColumn;
    case "progress":
      return EXPLORER_LABELS.syncLanesProgressColumn;
    case "last-action":
      return EXPLORER_LABELS.syncLanesLastActionColumn;
    case "counts":
      return EXPLORER_LABELS.syncLanesCountsColumn;
    case "status":
      return EXPLORER_LABELS.syncLanesStatusColumn;
  }
}

const SYNC_LANE_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<SyncLaneListColumnId>
> = SYNC_LANE_TOGGLEABLE_COLUMN_IDS.map((id) => ({
  id,
  label: getSyncLaneListColumnLabel(id),
}));

function getVisibleSyncLaneColumnIds(params: {
  compact: boolean;
  hiddenColumns: ReadonlySet<SyncLaneListColumnId>;
}): ReadonlyArray<SyncLaneListColumnId> {
  if (params.compact) {
    return SYNC_LANE_COMPACT_COLUMN_IDS;
  }

  return getVisibleMiniAppTableColumnIds(
    SYNC_LANE_LIST_COLUMN_IDS,
    params.hiddenColumns,
  );
}

// Wide-layout column widths, in rem. Kept as numbers (not "10rem" strings) so
// the list can sum the visible columns into the table's horizontal-scroll floor
// (see `tableMinWidth`) without parsing them back out.
const SYNC_LANE_COLUMN_WIDTH_REM: Record<SyncLaneListColumnId, number> = {
  lane: 10,
  phase: 7,
  progress: 11,
  "last-action": 12,
  counts: 12,
  status: 7,
};

function buildSyncLaneColumn(
  id: SyncLaneListColumnId,
  compact: boolean,
): MiniAppTableColumn {
  return {
    header: getSyncLaneListColumnLabel(id),
    id,
    // On the phone tier the lane is one of only two columns, so let it flex into
    // the remaining width. Every other column — and the lane in the wide layout
    // — keeps its fixed rem width; the compact lane label is ellipsis-clamped,
    // so its 10rem column no longer has to fit an opaque per-lane key.
    width:
      compact && id === "lane"
        ? undefined
        : `${SYNC_LANE_COLUMN_WIDTH_REM[id]}rem`,
  };
}

function renderSyncLaneCell(params: {
  columnId: SyncLaneListColumnId;
  lane: SyncLaneSnapshot;
  onOpenLaneDetail: (laneKey: string) => void;
}) {
  const { columnId, lane, onOpenLaneDetail } = params;

  switch (columnId) {
    case "lane": {
      // Roll the lane up to a compact, category-style name so the opaque
      // per-lane key suffix can never widen (or vertically stretch) this
      // column. The full label and key stay one tap away in the lane detail,
      // and the cell's `title` still surfaces them on hover.
      const compactLabel = getSyncLaneCompactLabel(lane);
      return (
        <MiniAppTableCell key="lane" title={`${lane.label}\n${lane.key}`}>
          <MiniAppTableActionButton
            aria-label={`${EXPLORER_LABELS.syncLanesOpenLaneAction}: ${lane.label}`}
            onClick={() => onOpenLaneDetail(lane.key)}
            title={lane.lastError ?? undefined}
          >
            <span className="explorer-sync-lane-list-primary">
              {/* No `title` here: it would shadow the cell's fuller
                  `${lane.label}\n${lane.key}` tooltip with just the compact
                  category name. */}
              <MiniAppTableText className="explorer-sync-lane-list-label">
                {compactLabel}
              </MiniAppTableText>
            </span>
          </MiniAppTableActionButton>
        </MiniAppTableCell>
      );
    }
    case "phase":
      return (
        <MiniAppTableCell key="phase">
          {getSyncLanePhaseLabel(lane.phase)}
        </MiniAppTableCell>
      );
    case "progress":
      return (
        <MiniAppTableCell
          className="explorer-sync-lane-list-cell--progress"
          key="progress"
        >
          <ExplorerSyncLaneProgress lane={lane} />
        </MiniAppTableCell>
      );
    case "last-action":
      return (
        <MiniAppTableCell key="last-action">
          <ExplorerSyncLaneLastAction lane={lane} />
        </MiniAppTableCell>
      );
    case "counts":
      return (
        <MiniAppTableCell key="counts">
          {getExplorerSyncLaneCountLabel({
            errorCount: lane.errorCount,
            requestCount: lane.requestCount,
            runCount: lane.runCount,
          })}
        </MiniAppTableCell>
      );
    case "status":
      return (
        <MiniAppTableCell key="status">
          <ExplorerSyncLaneStatusBadge status={lane.status} />
        </MiniAppTableCell>
      );
  }
}

export function ExplorerSyncLaneList(params: {
  // Reads differently for "there are no lanes at all" and "the active overview
  // filter hides every lane", so the caller — which owns the filter — supplies
  // it rather than the list guessing.
  emptyMessage: string;
  lanes: ReadonlyArray<SyncLaneSnapshot>;
  onOpenLaneDetail: (laneKey: string) => void;
}) {
  const compact = useRoutedLayoutTier() === "mobile";
  const columnVisibility = useMiniAppColumnVisibility<SyncLaneListColumnId>({
    storageKey: SYNC_LANE_COLUMN_STORAGE_KEY,
    toggleableColumnIds: SYNC_LANE_TOGGLEABLE_COLUMN_IDS,
  });
  const visibleColumnIds = useMemo(
    () =>
      getVisibleSyncLaneColumnIds({
        compact,
        hiddenColumns: columnVisibility.hiddenColumns,
      }),
    [compact, columnVisibility.hiddenColumns],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        visibleColumnIds.map((id) => buildSyncLaneColumn(id, compact)),
        // The column menu only toggles the wide-layout columns, which the
        // compact tier drops entirely, so hide it there.
        compact ? null : (
          <MiniAppColumnMenuButton
            ariaLabel={EXPLORER_LABELS.columnsMenuButton}
            hiddenColumns={columnVisibility.hiddenColumns}
            options={SYNC_LANE_COLUMN_MENU_OPTIONS}
            stateLabels={{
              off: EXPLORER_LABELS.columnsMenuStateOff,
              on: EXPLORER_LABELS.columnsMenuStateOn,
            }}
            toggleColumn={columnVisibility.toggleColumn}
          />
        ),
      ),
    [
      compact,
      columnVisibility.hiddenColumns,
      columnVisibility.toggleColumn,
      visibleColumnIds,
    ],
  );
  // Floor the table at the sum of its visible columns' fixed widths so a narrow
  // pane scrolls horizontally (within the frame) instead of crushing the
  // columns. Computed here rather than with CSS `min-width: max-content` because
  // Firefox derives a table's `max-content` from cell *content* — ignoring the
  // `table-layout: fixed` column widths — which stretched the columns far past
  // their rem widths and forced a huge horizontal scroll. The compact tier has
  // only two columns and its lane column flexes, so it needs no floor.
  const tableMinWidth = useMemo(
    () =>
      compact
        ? undefined
        : `${visibleColumnIds.reduce(
            (total, id) => total + SYNC_LANE_COLUMN_WIDTH_REM[id],
            0,
          )}rem`,
    [compact, visibleColumnIds],
  );

  return (
    <MiniAppTableFrame className="explorer-sync-lane-table-wrap mini-app-table-frame--bleed">
      <MiniAppTable
        aria-label={EXPLORER_LABELS.syncLanesTitle}
        columns={columns}
        style={tableMinWidth ? { minWidth: tableMinWidth } : undefined}
      >
        {params.lanes.length === 0 ? (
          <MiniAppTableEmptyRow colSpan={visibleColumnIds.length}>
            {params.emptyMessage}
          </MiniAppTableEmptyRow>
        ) : (
          params.lanes.map((lane) => (
            <MiniAppTableRow
              className="explorer-sync-lane-table-row"
              interactive
              key={lane.key}
              onActivate={() => params.onOpenLaneDetail(lane.key)}
            >
              {visibleColumnIds.map((columnId) =>
                renderSyncLaneCell({
                  columnId,
                  lane,
                  onOpenLaneDetail: params.onOpenLaneDetail,
                }),
              )}
            </MiniAppTableRow>
          ))
        )}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
