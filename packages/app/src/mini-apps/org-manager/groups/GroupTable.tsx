import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useMemo,
} from "react";
import { MiniAppStatus } from "../../../components/shared/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppColumnVisibility,
} from "../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../../components/shared/MiniAppVirtual";
import { useRoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { isKeyboardActivationKey } from "../display";
import { getOrgManagerMemberCountLabel, ORG_MANAGER_LABELS } from "../labels";

type GroupTableColumnId = "group" | "members" | "status" | "created";

const GROUP_TABLE_COLUMN_IDS: ReadonlyArray<GroupTableColumnId> = [
  "group",
  "members",
  "status",
  "created",
];
const GROUP_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<GroupTableColumnId> = [
  "members",
  "status",
  "created",
];
const EMPTY_GROUP_HIDDEN_COLUMNS = new Set<GroupTableColumnId>();
const GROUP_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<GroupTableColumnId>
> = [
  { id: "members", label: ORG_MANAGER_LABELS.members },
  { id: "status", label: ORG_MANAGER_LABELS.status },
  { id: "created", label: ORG_MANAGER_LABELS.created },
];

const GROUP_TABLE_COLUMNS = [
  {
    id: "group",
    header: ORG_MANAGER_LABELS.group,
    width: "48%",
  },
  {
    id: "members",
    header: ORG_MANAGER_LABELS.members,
    width: "8rem",
  },
  {
    id: "status",
    header: ORG_MANAGER_LABELS.status,
    width: "7rem",
  },
  {
    className: "org-manager-group-created-column",
    id: "created",
    header: ORG_MANAGER_LABELS.created,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: GroupTableColumnId }>;

function renderGroupCell(
  columnId: GroupTableColumnId,
  group: OrganizationGroupSummary,
): ReactNode {
  switch (columnId) {
    case "group":
      return (
        <MiniAppTableCell key="group">
          <MiniAppTableText title={group.groupId}>
            {group.name}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "members":
      return (
        <MiniAppTableCell key="members">
          <MiniAppTableText>
            {group.currentState
              ? getOrgManagerMemberCountLabel(group.currentState.memberCount)
              : ORG_MANAGER_LABELS.uninitialized}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "status":
      return (
        <MiniAppTableCell key="status">
          {group.isBuiltin ? (
            <MiniAppTableText>{ORG_MANAGER_LABELS.builtIn}</MiniAppTableText>
          ) : null}
        </MiniAppTableCell>
      );
    case "created":
      return (
        <MiniAppTableCell
          className="org-manager-group-created-column"
          key="created"
        >
          <MiniAppTableText title={group.createdAt}>
            {formatMiniAppDate(group.createdAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
  }
}

function useGroupTableColumns(): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<GroupTableColumnId>;
} {
  const compact = useRoutedLayoutTier() === "mobile";
  const columnVisibility = useMiniAppColumnVisibility<GroupTableColumnId>({
    storageKey: "tearleads.org-manager.groups:hidden-columns",
    toggleableColumnIds: GROUP_TOGGLEABLE_COLUMN_IDS,
  });
  const appliedHiddenColumns = compact
    ? EMPTY_GROUP_HIDDEN_COLUMNS
    : columnVisibility.hiddenColumns;
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        GROUP_TABLE_COLUMN_IDS,
        appliedHiddenColumns,
      ),
    [appliedHiddenColumns],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        GROUP_TABLE_COLUMNS.filter(
          (column) => !appliedHiddenColumns.has(column.id),
        ),
        compact ? null : (
          <MiniAppColumnMenuButton
            ariaLabel={ORG_MANAGER_LABELS.columns}
            hiddenColumns={columnVisibility.hiddenColumns}
            options={GROUP_COLUMN_MENU_OPTIONS}
            stateLabels={{
              off: ORG_MANAGER_LABELS.columnsMenuStateOff,
              on: ORG_MANAGER_LABELS.columnsMenuStateOn,
            }}
            toggleColumn={columnVisibility.toggleColumn}
          />
        ),
      ),
    [
      appliedHiddenColumns,
      columnVisibility.hiddenColumns,
      columnVisibility.toggleColumn,
      compact,
    ],
  );

  return { columns, visibleColumnIds };
}

function GroupTable({
  groups,
  openGroupContextMenu,
  selectedGroupId,
  setSelectedGroupId,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroupId: string | null;
  setSelectedGroupId: (groupId: string) => void;
}) {
  const virtualGroups = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: groups,
  });
  const { columns, visibleColumnIds } = useGroupTableColumns();

  if (groups.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroups}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        openGroupContextMenu(event, null);
      }}
      ref={virtualGroups.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable aria-label={ORG_MANAGER_LABELS.groups} columns={columns}>
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualGroups.topPadding}
        />
        {virtualGroups.rows.map((group) => {
          const isSelected = selectedGroupId === group.groupId;
          const openGroupDetail = () => setSelectedGroupId(group.groupId);
          const handleGroupRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openGroupDetail();
            }
          };

          return (
            <MiniAppTableRow
              aria-selected={isSelected}
              interactive
              key={group.groupId}
              onClick={openGroupDetail}
              onContextMenu={(event) =>
                openGroupContextMenu(event, group.groupId)
              }
              onKeyDown={handleGroupRowKeyDown}
              selected={isSelected}
              tabIndex={0}
            >
              {visibleColumnIds.map((columnId) =>
                renderGroupCell(columnId, group),
              )}
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualGroups.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function GroupListSection({
  groups,
  openGroupContextMenu,
  selectedGroupId,
  selectGroup,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroupId: string | null;
  selectGroup: (groupId: string | null) => void;
}) {
  return (
    <section
      aria-label={ORG_MANAGER_LABELS.groups}
      className="org-manager-panel org-manager-panel--context-target"
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        openGroupContextMenu(event, null);
      }}
    >
      <GroupTable
        groups={groups}
        openGroupContextMenu={openGroupContextMenu}
        selectedGroupId={selectedGroupId}
        setSelectedGroupId={selectGroup}
      />
    </section>
  );
}
