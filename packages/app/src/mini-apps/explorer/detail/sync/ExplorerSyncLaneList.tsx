import type { SyncLaneSnapshot } from "@tearleads/client-sdk";
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
} from "../../../../components/shared/MiniAppTable";
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
  "tearleads.explorer.sync-lanes:hidden-columns";

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

function buildSyncLaneColumn(
  id: SyncLaneListColumnId,
  compact: boolean,
): MiniAppTableColumn {
  switch (id) {
    case "lane":
      return {
        header: getSyncLaneListColumnLabel(id),
        id,
        // On the phone tier the lane is one of only two columns, so let it take
        // the remaining width. In the wide layout give it a concrete floor
        // (rather than a percentage that collapses when the pane is too narrow
        // for all six columns) so the compact lane label keeps its own column;
        // the label is a short category name and is ellipsis-clamped, so this
        // floor no longer has to fit an opaque per-lane key.
        width: compact ? undefined : "10rem",
      };
    case "phase":
      return {
        header: getSyncLaneListColumnLabel(id),
        id,
        width: "7rem",
      };
    case "progress":
      return {
        header: getSyncLaneListColumnLabel(id),
        id,
        width: "11rem",
      };
    case "last-action":
      return {
        header: getSyncLaneListColumnLabel(id),
        id,
        width: "12rem",
      };
    case "counts":
      return {
        header: getSyncLaneListColumnLabel(id),
        id,
        width: "12rem",
      };
    case "status":
      return {
        header: getSyncLaneListColumnLabel(id),
        id,
        width: "7rem",
      };
  }
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
            className="explorer-sync-lane-row-button"
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

  return (
    <MiniAppTableFrame className="explorer-sync-lane-table-wrap">
      <MiniAppTable
        aria-label={EXPLORER_LABELS.syncLanesTitle}
        columns={columns}
      >
        {params.lanes.length === 0 ? (
          <MiniAppTableEmptyRow colSpan={visibleColumnIds.length}>
            {EXPLORER_LABELS.syncLanesNoLanes}
          </MiniAppTableEmptyRow>
        ) : (
          params.lanes.map((lane) => (
            <MiniAppTableRow
              className="explorer-sync-lane-table-row"
              interactive
              key={lane.key}
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
