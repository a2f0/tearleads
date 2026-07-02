import type { SyncLaneSnapshot } from "@tearleads/client-sdk";
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
} from "../../../components/shared/MiniAppTable";
import { EXPLORER_LABELS, getExplorerSyncLaneCountLabel } from "../labels";
import {
  ExplorerSyncLaneLastAction,
  ExplorerSyncLaneProgress,
  ExplorerSyncLaneStatusBadge,
} from "./ExplorerSyncLaneShared";
import { getSyncLanePhaseLabel } from "./ExplorerSyncLaneUtils";

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

function getVisibleSyncLaneColumnIds(
  hiddenColumns: ReadonlySet<SyncLaneListColumnId>,
): ReadonlyArray<SyncLaneListColumnId> {
  return getVisibleMiniAppTableColumnIds(
    SYNC_LANE_LIST_COLUMN_IDS,
    hiddenColumns,
  );
}

function buildSyncLaneColumn(id: SyncLaneListColumnId): MiniAppTableColumn {
  switch (id) {
    case "lane":
      return {
        header: getSyncLaneListColumnLabel(id),
        id,
        width: "32%",
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
    case "lane":
      return (
        <MiniAppTableCell key="lane" title={lane.key}>
          <MiniAppTableActionButton
            aria-label={`${EXPLORER_LABELS.syncLanesOpenLaneAction}: ${lane.label}`}
            className="explorer-sync-lane-row-button"
            onClick={() => onOpenLaneDetail(lane.key)}
            title={lane.lastError ?? undefined}
          >
            <span className="explorer-sync-lane-list-primary">
              <MiniAppTableText
                className="explorer-sync-lane-list-label"
                title={lane.label}
              >
                {lane.label}
              </MiniAppTableText>
              <code>{lane.key}</code>
            </span>
          </MiniAppTableActionButton>
        </MiniAppTableCell>
      );
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
  const columnVisibility = useMiniAppColumnVisibility<SyncLaneListColumnId>({
    storageKey: SYNC_LANE_COLUMN_STORAGE_KEY,
    toggleableColumnIds: SYNC_LANE_TOGGLEABLE_COLUMN_IDS,
  });
  const visibleColumnIds = getVisibleSyncLaneColumnIds(
    columnVisibility.hiddenColumns,
  );
  const columns = addMiniAppTableHeaderAction(
    visibleColumnIds.map(buildSyncLaneColumn),
    <MiniAppColumnMenuButton
      ariaLabel={EXPLORER_LABELS.columnsMenuButton}
      hiddenColumns={columnVisibility.hiddenColumns}
      options={SYNC_LANE_COLUMN_MENU_OPTIONS}
      stateLabels={{
        off: EXPLORER_LABELS.columnsMenuStateOff,
        on: EXPLORER_LABELS.columnsMenuStateOn,
      }}
      toggleColumn={columnVisibility.toggleColumn}
    />,
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
